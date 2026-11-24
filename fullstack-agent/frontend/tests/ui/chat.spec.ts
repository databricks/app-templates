import type { Locator, Page, Route } from "@playwright/test";
import {
  ANNOUNCER,
  ANSWER_TEXT,
  asked,
  ASSISTANT_MESSAGE,
  called,
  checkScreen,
  expect,
  failed,
  LOADER,
  narrated,
  NOTE_TEXT,
  ok,
  QUESTION_TEXT,
  replayed,
  type Reply,
  run,
  said,
  sse,
  step,
  STEP,
  stepDone,
  stepped,
  STEPS,
  STEPS_TOGGLE,
  storedRuns,
  test,
  USER_MESSAGE,
  VIEWPORT,
  whole,
} from "./fixtures";
import { SUPPORT_NAME } from "../../src/config/brand";
import { COMPOSER_PLACEHOLDER, SUGGESTIONS } from "../../src/config/suggestions";

const QUESTION = "What are my records and the reference list?";
const ANSWER = "Your open records hold 3 items. The reference list has 12 entries.";
const NOTE = "I'll look at your records and the reference list.";
const READ_STEP = "Looking at your records";
const REFERENCE_STEP = "Checking the reference list";
const RAW_ERROR = "PERMISSION_DENIED: User does not have MODIFY on Table 'test_data.records'.";
const INVOKE = "POST /api/invocations";
const RENAME = { record_id: "R-1001", name: "Archive" };
const ARCHIVE = { record_id: "R-1002" };
const RENAME_STEP = "Preparing the new name for your record";
const SHOW_STEP = "Showing your records";
const ARCHIVE_STEP = "Preparing to archive your record";
const RENAME_QUESTION = "Rename record R-1001 to Archive";
const ARCHIVE_QUESTION = "Archive record R-1002";
const APPROVE = { name: "Confirm", exact: true };
const CARD_TITLE = "Confirm this change";
const WAITING = "It's waiting for your confirmation.";
const OUTCOME_UNKNOWN = "We couldn't confirm whether this change went through. Use Try again; it won't be made twice.";
const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");
const CONVERSATION = "GET /api/sessions/c1";
const STILL_WRITING = "This answer is still in progress.";
const STOPPED = "Stopped by you";
const TOGGLES = `${STEPS} [data-slot="collapsible-trigger"]`;

/** Conversation c1 with no running or open change unless specified. */
function conversation(details: Record<string, unknown> = {}): Reply {
  return ok({
    id: "c1",
    title: QUESTION,
    messages: [{ role: "user", content: QUESTION }],
    runs: [],
    running: null,
    ...details,
  });
}

/** Hold requests to a route; return the first one made. */
async function hold(page: Page, url: string): Promise<() => Promise<Route>> {
  const held: Route[] = [];
  await page.route(url, (route) => {
    held.push(route);
  });
  return async () => {
    await expect.poll(() => held.length).toBeGreaterThan(0);
    return held[0];
  };
}

/** Open all collapsed note and step groups. */
async function openWork(reply: Locator): Promise<void> {
  for (const toggle of await reply.locator(TOGGLES).all()) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") continue;
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

function proposed(action: string, args: Record<string, string>): Reply {
  const label = action === "rename_record" ? RENAME_STEP : ARCHIVE_STEP;
  return run(
    MODEL,
    step("call_1", label),
    { type: "confirmation_required", proposal_id: "p1", action, args },
    stepDone("call_1"),
    said(WAITING),
  );
}

/** Hold replay request for early-ended stream; return once asked. */
async function holdReplay(page: Page): Promise<() => Promise<Route>> {
  let replay: Route | undefined;
  await page.route("**/api/invocations/*/events*", (route) => {
    replay = route;
  });
  return async () => {
    await expect.poll(() => replay).toBeDefined();
    return replay as Route;
  };
}

function decided(action: string, outcome: "allowed" | "denied" | "rejected_by_user", details = {}, reply = ""): Reply {
  const event = called(action, "user", `agent_ops.${action}`, outcome, { proposal_id: "p1", ...details });
  return run(event, reply ? said(reply) : []);
}

test.beforeEach(async ({ api }) => {
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: QUESTION }), status: 201 });
});

test("an answer shows only its final text, with its notes and steps in one closed timeline above it", async ({ page, api }) => {
  api.reply(
    INVOKE,
    run(
      MODEL,
      narrated(1, NOTE),
      step("call_1", READ_STEP),
      step("call_2", REFERENCE_STEP),
      called("read_records", "user", "test_data.records", "allowed", { call_id: "call_1" }),
      stepDone("call_1"),
      called("read_reference", "app", "test_reference.items", "allowed", { call_id: "call_2" }),
      stepDone("call_2"),
      said(ANSWER),
    ),
  );
  await page.goto("/");
  await ask(page, QUESTION);

  const answer = page.locator(ASSISTANT_MESSAGE);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer.locator(ANSWER_TEXT)).toHaveText([ANSWER]);
  const toggle = answer.locator(STEPS).getByRole("button", STEPS_TOGGLE);
  await expect(toggle).toHaveAccessibleName("Used 2 tools");
  await expect(answer.locator(TOGGLES)).toHaveCount(1);
  for (const item of await answer.locator(TOGGLES).all()) await expect(item).toHaveAttribute("aria-expanded", "false");
  await expect(answer.locator(STEP)).toHaveCount(0);

  await openWork(answer);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(answer.locator(NOTE_TEXT)).toHaveText([NOTE]);
  const steps = answer.locator(STEP);
  await expect(steps).toHaveText([`${READ_STEP}, Done`, `${REFERENCE_STEP}, Done`]);
  await expect(steps.nth(0)).toHaveAttribute("data-state", "done");
  await expect(answer.locator('[data-slot="badge"]')).toHaveCount(0);
  await expect(answer.locator(STEPS)).not.toContainText(/Your data|information/);
  await expect(answer).not.toContainText("agent_");
  await expect(answer).not.toContainText("read_records");
  await checkScreen(page, "answer-thinking");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(steps).toHaveCount(0);
});

test("notes and steps stay where they arrived, above the answer", async ({ page, api }) => {
  const second = "Now I'll check the reference list.";
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, { type: "delta", content: NOTE }]));
  const replay = await holdReplay(page);
  await page.goto("/");
  await ask(page, QUESTION);

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply.locator(ANSWER_TEXT)).toHaveText(NOTE);
  await expect(reply.locator(STEPS)).toHaveCount(0);

  await replayed(await replay(), [
    { type: "narration", id: 1, text: NOTE },
    ...stepped("call_1", READ_STEP),
    ...narrated(2, second),
    ...stepped("call_2", REFERENCE_STEP),
    ...said(ANSWER),
    { type: "run.completed" },
  ]);
  await expect(reply).toHaveAttribute("data-status", "complete");
  await openWork(reply);
  await expect(reply.locator(STEPS)).toHaveCount(1);
  await expect(reply.locator(`${NOTE_TEXT}, ${STEP}`)).toHaveCount(4);
  await expect(reply.locator(`${NOTE_TEXT}, ${STEP}, ${ANSWER_TEXT}`)).toHaveText([
    NOTE,
    `${READ_STEP}, Done`,
    second,
    `${REFERENCE_STEP}, Done`,
    ANSWER,
  ]);
});

/** Event order for a live run: read, propose, answer. Cuts mark where stream pauses. */
const NOTE_TWO = "Now I'll prepare the new name for you to confirm.";
const CONFIRM_ANSWER = "The new name is ready on the card. Confirm it or cancel.";
const LIVE_ORDER = [
  { type: "run.started" },
  { type: "received", at: new Date(2026, 9, 10, 14, 0).toISOString() },
  MODEL,
  { type: "delta", content: NOTE.slice(0, 20) },
  { type: "narration", id: 1, text: NOTE },
  { type: "status", step: "call_1", tool: "read_records", text: READ_STEP, at: new Date(2026, 9, 10, 14, 0, 1).toISOString() },
  called("read_records", "user", "test_data.records", "allowed", { call_id: "call_1" }),
  { type: "step.done", step: "call_1", at: new Date(2026, 9, 10, 14, 0, 2).toISOString() },
  { type: "delta", content: NOTE_TWO.slice(0, 20) },
  { type: "delta", content: NOTE_TWO.slice(20, 30) },
  { type: "narration", id: 2, text: NOTE_TWO },
  { type: "status", step: "call_2", tool: "rename_record", text: RENAME_STEP, at: new Date(2026, 9, 10, 14, 0, 3).toISOString() },
  { type: "confirmation_required", proposal_id: "p1", action: "rename_record", args: RENAME },
  { type: "step.done", step: "call_2", at: new Date(2026, 9, 10, 14, 0, 4).toISOString() },
  ...[0, 15, 30, 45].map((start) => ({ type: "delta", content: CONFIRM_ANSWER.slice(start, start + 15) })),
  { type: "work.done", seconds: 4 },
  { type: "message", message: { role: "assistant", content: CONFIRM_ANSWER } },
  { type: "usage", requests: 3, input_tokens: 9000, output_tokens: 300 },
  { type: "run.completed" },
];

/** Same run but with a display instead of a card: read, show table, answer. */
const DISPLAY_ANSWER = "Your records are in the table above, newest first.";
const DISPLAY_ORDER = [
  ...LIVE_ORDER.slice(0, 11),
  { type: "status", step: "call_2", tool: "show_table", text: SHOW_STEP, at: new Date(2026, 9, 10, 14, 0, 3).toISOString() },
  {
    type: "display",
    call_id: "call_2",
    view: "table",
    payload: { title: "Your records", columns: [{ key: "name", label: "Record" }], rows: [{ name: "Archive" }, { name: "Drafts" }] },
  },
  { type: "step.done", step: "call_2", at: new Date(2026, 9, 10, 14, 0, 4).toISOString() },
  ...[0, 15, 30, 45].map((start) => ({ type: "delta", content: DISPLAY_ANSWER.slice(start, start + 15) })),
  { type: "work.done", seconds: 4 },
  { type: "message", message: { role: "assistant", content: DISPLAY_ANSWER } },
  { type: "run.completed" },
];

/** Stream events in pieces marked by cuts, calling stage after each. */
async function streamLive(
  page: Page,
  api: { reply: (route: string, ...replies: Reply[]) => void },
  order: Record<string, unknown>[],
  cuts: number[],
  stage: (index: number) => Promise<void>,
) {
  const pieces = [0, ...cuts, order.length].slice(1).map((end, index, ends) => order.slice(index === 0 ? 0 : ends[index - 1], end));
  const held: Route[] = [];
  await page.route("**/api/invocations/*/events*", (route) => {
    held.push(route);
  });
  api.reply(INVOKE, sse(pieces[0]));
  await page.goto("/");
  await ask(page, RENAME_QUESTION);
  for (let index = 0; index < pieces.length; index++) {
    if (index > 0) {
      await expect.poll(() => held.length).toBe(index);
      await replayed(held[index - 1], pieces[index]);
    }
    await stage(index);
  }
}

/** Offset of locator from top of its message; ignores scrolling. */
async function offset(page: Page, locator: Locator): Promise<number> {
  const [box, message] = [await locator.boundingBox(), await page.locator(ASSISTANT_MESSAGE).boundingBox()];
  return box!.y - message!.y;
}

const MOVE_LIMIT = 6;

test("a live run streams in one calm order: notes and steps as one timeline, the card, then the answer", async ({ page, api }) => {
  const reply = page.locator(ASSISTANT_MESSAGE);
  const timeline = reply.locator(STEPS);
  let textTop = 0;
  let timelineTop = 0;
  await streamLive(page, api, LIVE_ORDER, [4, 6, 10], async (index) => {
    if (index === 0) {
      await expect(reply.locator(LOADER)).toHaveText("Writing");
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(NOTE.slice(0, 20));
      textTop = await offset(page, reply.locator(ANSWER_TEXT));
      await checkScreen(page, "order-1-first-text");
    } else if (index === 1) {
      await expect(reply.locator(NOTE_TEXT)).toHaveText([NOTE]);
      await expect(reply.locator(STEP)).toHaveAttribute("data-state", "running");
      await expect(reply.locator(ANSWER_TEXT)).toHaveCount(0);
      expect(Math.abs((await offset(page, reply.locator(NOTE_TEXT))) - textTop)).toBeLessThanOrEqual(MOVE_LIMIT);
      timelineTop = await offset(page, timeline);
      await checkScreen(page, "order-2-first-step");
    } else if (index === 2) {
      await expect(reply.locator(STEP)).toHaveAttribute("data-state", "done");
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(NOTE_TWO.slice(0, 30));
      expect(await offset(page, timeline)).toBe(timelineTop);
      textTop = await offset(page, reply.locator(ANSWER_TEXT));
      await checkScreen(page, "order-3-second-text");
    } else {
      await expect(reply).toHaveAttribute("data-status", "complete");
    }
  });
});

test("a live run keeps a display after its step and streams the answer below it", async ({ page, api }) => {
  const reply = page.locator(ASSISTANT_MESSAGE);
  const timeline = reply.locator(STEPS);
  const table = reply.locator('[data-slot="data-table"]');
  let textTop = 0;
  let timelineTop = 0;
  let tableTop = 0;
  await streamLive(page, api, DISPLAY_ORDER, [10, 13, 18], async (index) => {
    if (index === 0) {
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(NOTE_TWO.slice(0, 30));
      textTop = await offset(page, reply.locator(ANSWER_TEXT));
      timelineTop = await offset(page, timeline);
    } else if (index === 1) {
      await expect(reply.locator(NOTE_TEXT)).toHaveText([NOTE, NOTE_TWO]);
      await expect(reply.locator(STEP).last()).toHaveText(`${SHOW_STEP}, In progress`);
      await expect(table).toContainText("Drafts");
      await expect(reply.locator(ANSWER_TEXT)).toHaveCount(0);
      expect(Math.abs((await offset(page, reply.locator(NOTE_TEXT).last())) - textTop)).toBeLessThanOrEqual(MOVE_LIMIT);
      expect(await offset(page, timeline)).toBe(timelineTop);
      tableTop = await offset(page, table);
      expect(tableTop).toBeGreaterThan(timelineTop + ((await timeline.boundingBox())?.height ?? 0) - 1);
      await checkScreen(page, "order-display");
    } else if (index === 2) {
      await expect(reply.locator(STEP).last()).toHaveAttribute("data-state", "done");
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(DISPLAY_ANSWER);
      expect(await offset(page, table)).toBe(tableTop);
      textTop = await offset(page, reply.locator(ANSWER_TEXT));
      expect(textTop).toBeGreaterThan(tableTop + ((await table.boundingBox())?.height ?? 0) - 1);
      await checkScreen(page, "order-display-answer-streaming");
    } else {
      await expect(reply).toHaveAttribute("data-status", "complete");
      await expect(timeline.getByRole("button", STEPS_TOGGLE)).toHaveAccessibleName("Used 2 tools · 3s");
      const tops = [await offset(page, timeline), await offset(page, table), await offset(page, reply.locator(ANSWER_TEXT))];
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      await checkScreen(page, "order-display-done");
    }
  });
});

test("a live run keeps the card after its step and streams the answer below the card", async ({ page, api }) => {
  const reply = page.locator(ASSISTANT_MESSAGE);
  const timeline = reply.locator(STEPS);
  const card = page.getByTestId("confirm-card");
  let textTop = 0;
  let timelineTop = 0;
  let cardTop = 0;
  await streamLive(page, api, LIVE_ORDER, [10, 13, 18], async (index) => {
    if (index === 0) {
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(NOTE_TWO.slice(0, 30));
      textTop = await offset(page, reply.locator(ANSWER_TEXT));
      timelineTop = await offset(page, timeline);
    } else if (index === 1) {
      await expect(reply.locator(NOTE_TEXT)).toHaveText([NOTE, NOTE_TWO]);
      await expect(reply.locator(STEP).last()).toHaveAttribute("data-state", "running");
      await expect(card.getByRole("button", APPROVE)).toBeVisible();
      await expect(reply.locator(ANSWER_TEXT)).toHaveCount(0);
      expect(Math.abs((await offset(page, reply.locator(NOTE_TEXT).last())) - textTop)).toBeLessThanOrEqual(MOVE_LIMIT);
      expect(await offset(page, timeline)).toBe(timelineTop);
      cardTop = await offset(page, card);
      expect(cardTop).toBeGreaterThan(timelineTop + ((await timeline.boundingBox())?.height ?? 0) - 1);
      await checkScreen(page, "order-4-card");
    } else if (index === 2) {
      await expect(reply.locator(STEP).last()).toHaveAttribute("data-state", "done");
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(CONFIRM_ANSWER);
      expect(await offset(page, card)).toBe(cardTop);
      textTop = await offset(page, reply.locator(ANSWER_TEXT));
      expect(textTop).toBeGreaterThan(cardTop + ((await card.boundingBox())?.height ?? 0) - 1);
      await checkScreen(page, "order-5-answer-streaming");
    } else {
      await expect(reply).toHaveAttribute("data-status", "complete");
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(CONFIRM_ANSWER);
      await expect(timeline.getByRole("button", STEPS_TOGGLE)).toHaveAccessibleName("Used 2 tools · 3s");
      const tops = [await offset(page, timeline), await offset(page, card), await offset(page, reply.locator(ANSWER_TEXT))];
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      await expect(reply.locator('[data-slot="message-timing"]')).toHaveText("worked4s");
      await checkScreen(page, "order-6-done");
    }
  });
});

for (const { name, order, slot } of [
  { name: "display", order: DISPLAY_ORDER, slot: '[data-slot="data-table"]' },
  { name: "card", order: LIVE_ORDER, slot: '[data-testid="confirm-card"]' },
]) {
  test(`once a ${name}'s step ends, Thinking shows below it until the answer starts`, async ({ page, api }) => {
    const reply = page.locator(ASSISTANT_MESSAGE);
    const shown = reply.locator(slot);
    await streamLive(page, api, order, [13, 14], async (index) => {
      if (index === 0) {
        await expect(shown).toBeVisible();
        await expect(reply.locator(STEP).last()).toHaveAttribute("data-state", "running");
        await expect(reply.locator(LOADER)).toHaveCount(0);
      } else if (index === 1) {
        await expect(reply.locator(STEP).last()).toHaveAttribute("data-state", "done");
        await expect(reply.locator(LOADER)).toHaveText("Thinking");
        const below = (await offset(page, shown)) + ((await shown.boundingBox())?.height ?? 0);
        expect(await offset(page, reply.locator(LOADER))).toBeGreaterThan(below - 1);
        await checkScreen(page, `thinking-after-${name}`);
      } else {
        await expect(reply).toHaveAttribute("data-status", "complete");
        await expect(reply.locator(ANSWER_TEXT)).toHaveCount(1);
        await expect(reply.locator(LOADER)).toHaveCount(0);
      }
    });
  });
}

test("a long step wraps in full, without horizontal overflow", async ({ page, api }) => {
  const long = `${READ_STEP}, ${"your recent records and your saved notes, ".repeat(6)}and your files`;
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, ...narrated(1, NOTE), step("call_1", long)]));
  await holdReplay(page);
  await page.goto("/");
  await ask(page, QUESTION);

  const line = page.locator(STEP);
  await expect(line).toHaveText(`${long}, In progress`);
  const lineHeight = await line.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
  expect((await line.boundingBox())?.height).toBeGreaterThan(lineHeight * 1.5);
  await checkScreen(page, "step-long");
});

test("a finished answer can be copied without its note or steps, and says Copied", async ({ page, context, api }, testInfo) => {
  if (testInfo.project.name !== "phone-webkit") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  api.reply(
    INVOKE,
    sse([{ type: "run.started" }, MODEL, ...narrated(1, NOTE), ...stepped("call_1", READ_STEP), ...said(ANSWER)]),
  );
  const replay = await holdReplay(page);
  await page.goto("/");
  await ask(page, QUESTION);

  const answer = page.locator(ASSISTANT_MESSAGE);
  const copy = answer.getByRole("button", { name: "Copy", exact: true });
  await expect(answer.locator(ANSWER_TEXT)).toHaveText([ANSWER]);
  await expect(answer).toHaveAttribute("data-status", "running");
  await expect(copy).toHaveCount(0);

  await (await replay()).fulfill(sse([{ type: "run.completed" }], 100));
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(page.locator(ANNOUNCER)).toHaveText(ANSWER);
  await copy.click();
  await expect(page.locator(ANNOUNCER)).toHaveText("Copied");
  if (testInfo.project.name !== "phone-webkit") {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ANSWER);
  }
  await checkScreen(page, "answer-copied");
});

test("scrolled up during an answer, a button returns to the latest message", async ({ page, api }) => {
  const history = Array.from({ length: 12 }, (_, index) => [
    { role: "user", content: `Question ${index + 1}` },
    { role: "assistant", content: `${ANSWER} ${ANSWER} ${ANSWER}` },
  ]).flat();
  api.reply(CONVERSATION, conversation({ messages: history }));
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, { type: "delta", content: "Your open" }]));
  await holdReplay(page);
  await page.goto("/#/assistant/c1");
  await ask(page, QUESTION);
  await expect(page.locator(ASSISTANT_MESSAGE).last().locator(ANSWER_TEXT)).toHaveText("Your open");

  const scroller = page.locator(VIEWPORT);
  const latest = page.getByRole("button", { name: "Scroll to bottom" });
  const fromBottom = () => scroller.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect(latest).toBeVisible();
  await checkScreen(page, "scroll-latest");
  await latest.click();
  await expect.poll(fromBottom).toBeLessThan(2);
  await expect(latest).toBeHidden();
});

test("the last answer offers Copy, and an earlier one offers it on hover", async ({ page, api }) => {
  const runs = storedRuns(
    { id: "inv-1", input: asked(QUESTION), events: whole(MODEL, said(ANSWER)) },
    {
      id: "inv-2",
      input: asked(RENAME_QUESTION),
      events: whole(MODEL, { type: "confirmation_required", proposal_id: "p1", action: "rename_record", args: RENAME }, said(WAITING)),
    },
  );
  api.reply(CONVERSATION, conversation({ runs }));
  await page.goto("/#/assistant/c1");
  await expect(page.getByTestId("confirm-card")).toBeVisible();
  const messages = page.locator(ASSISTANT_MESSAGE);
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(1).getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  const earlier = messages.nth(0).getByRole("button", { name: "Copy", exact: true });
  await expect(earlier).toBeHidden();
  await messages.nth(0).hover();
  await expect(earlier).toBeVisible();
});

test("a message with a card offers Copy once it has ended, for its reply text alone", async ({ page, api }) => {
  api.reply(
    INVOKE,
    proposed("archive_record", ARCHIVE),
    decided("archive_record", "allowed", { status: "OK", reference: "REF-1" }, "Change completed. Your reference is REF-1."),
  );
  await page.goto("/");
  await ask(page, ARCHIVE_QUESTION);

  const message = page.locator(ASSISTANT_MESSAGE);
  const card = message.getByTestId("confirm-card");
  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Waiting for your confirmation");
  await expect(message).toHaveAttribute("data-status", "complete");
  await expect(message).toContainText(WAITING);
  await expect(message.getByRole("button", { name: "Copy", exact: true })).toBeVisible();

  await card.getByRole("button", APPROVE).click();
  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Completed");
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(1);
  await expect(message.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
});

test("a refused read shows a failed step, without the raw error", async ({ page, api }) => {
  api.reply(
    INVOKE,
    run(
      MODEL,
      narrated(1, "I'll look at your recent records."),
      stepped(
        "call_1",
        "Looking at your recent records",
        called("read_records", "user", "test_data.notes", "denied", { error: RAW_ERROR }),
      ),
      said("I couldn't look at your records just now."),
    ),
  );
  await page.goto("/");
  await ask(page, QUESTION);

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply).toHaveAttribute("data-status", "complete");
  await openWork(reply);
  const failedStep = reply.locator(STEP);
  await expect(failedStep).toHaveAttribute("data-state", "failed");
  await expect(failedStep).toContainText("Looking at your recent records, Couldn't finish");
  await expect(reply.locator(STEPS).locator(".animate-spin")).toHaveCount(0);
  await expect(reply.locator('[data-slot="tool-error"]')).toContainText("This step couldn't finish.");
  await expect(page.locator("body")).not.toContainText("MODIFY");
});

test("a reply without tools shows no notes or steps, and announces nothing while it waits", async ({ page, api }) => {
  let question: Route | undefined;
  await page.route(
    "**/api/invocations",
    (route) => {
      question = route;
    },
    { times: 1 },
  );
  await page.goto("/");
  await ask(page, "Hello");

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply.locator(LOADER)).toBeVisible();
  await expect(reply).toHaveText("Thinking");
  await expect(page.locator(ANNOUNCER)).toHaveText("");
  await expect.poll(() => question).toBeDefined();
  await question?.fulfill(run(MODEL, said("Hello. How can I help today?")));

  await expect(reply.locator(ANSWER_TEXT)).toHaveText("Hello. How can I help today?");
  await expect(reply.locator(STEPS)).toHaveCount(0);
  await expect(reply.locator(LOADER)).toHaveCount(0);
});

test("a first question shows its answer waiting at once, while the conversation is created", async ({ page, api }) => {
  let create: Route | undefined;
  await page.route("**/api/sessions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    create = route;
  });
  api.reply(INVOKE, run(MODEL, said(ANSWER)));
  await page.goto("/");
  await ask(page, QUESTION);

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply.locator(LOADER)).toHaveText("Thinking");
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect.poll(() => create).toBeDefined();
  expect(api.posted(INVOKE)).toHaveLength(0);

  await create!.fulfill({ ...ok({ id: "c1", title: QUESTION }), status: 201 });
  await expect(reply).toHaveCount(1);
  await expect(reply.locator(ANSWER_TEXT)).toHaveText(ANSWER);
});

test("opening another conversation while a new one is created leaves the question unasked", async ({ page, api }) => {
  let create: Route | undefined;
  await page.route("**/api/sessions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    create = route;
  });
  const earlier = storedRuns({ id: "r1", input: asked("Earlier question"), events: whole(MODEL, said("Earlier answer")) });
  api.reply("GET /api/sessions/c2", ok({ id: "c2", title: "Earlier question", messages: [], runs: earlier, running: null }));
  await page.goto("/");
  await ask(page, QUESTION);
  await expect.poll(() => create).toBeDefined();

  await page.evaluate(() => {
    window.location.hash = "#/assistant/c2";
  });
  await expect(page.locator(ANSWER_TEXT)).toHaveText("Earlier answer");
  await create!.fulfill({ ...ok({ id: "c1", title: QUESTION }), status: 201 });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));

  await expect(page).toHaveURL(/#\/assistant\/c2$/);
  await expect(page.locator(QUESTION_TEXT)).toHaveText("Earlier question");
  await expect(page.locator(ANSWER_TEXT)).toHaveText("Earlier answer");
  expect(api.posted(INVOKE)).toHaveLength(0);
});

test("while a run goes on, its notes and steps stay open and the steps' toggle shows it working", async ({
  page,
  api,
}) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, ...narrated(1, NOTE), step("call_1", READ_STEP)]));
  const replay = await holdReplay(page);
  await page.goto("/");
  await ask(page, QUESTION);

  const reply = page.locator(ASSISTANT_MESSAGE);
  const toggle = reply.locator(STEPS).getByRole("button", STEPS_TOGGLE);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAccessibleName("Using tools");
  await expect(toggle.locator(".shimmer")).toHaveCount(1);
  await expect(reply.locator(NOTE_TEXT)).toHaveText([NOTE]);
  await expect(reply.locator(STEP)).toHaveAttribute("data-state", "running");
  await expect(reply.locator(STEPS).locator(".animate-spin")).toBeVisible();
  await expect(reply.locator(ANSWER_TEXT)).toHaveCount(0);
  await expect(page.locator(ANNOUNCER)).toHaveText(READ_STEP);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await replayed(await replay(), [
    called("read_records", "user", "test_data.records", "allowed", { call_id: "call_1" }),
    stepDone("call_1"),
    ...said(ANSWER),
    { type: "run.completed" },
  ]);
  await expect(reply).toHaveAttribute("data-status", "complete");
  await expect(toggle).toHaveAccessibleName("Used 1 tool");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(reply.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await expect(reply.locator(LOADER)).toHaveCount(0);
});

test("an answer that pauses while streaming keeps a dot at its end", async ({ page, api }) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, { type: "delta", content: "Your open records" }]));
  const replay = await holdReplay(page);
  await page.goto("/");
  await ask(page, QUESTION);

  const answer = page.locator(ANSWER_TEXT);
  await expect(answer).toHaveText("Your open records");
  await expect(answer).toHaveAttribute("data-status", "running");
  const dot = () => answer.locator("p").last().evaluate((element) => getComputedStyle(element, "::after").content);
  expect(await dot()).not.toBe("none");
  await expect(page.locator(LOADER)).toHaveText("Writing");
  await expect(page.locator(STEPS)).toHaveCount(0);

  await replayed(await replay(), [...said(ANSWER), { type: "run.completed" }]);
  await expect(answer).toHaveText(ANSWER);
  await expect(answer).toHaveAttribute("data-status", "complete");
  expect(await dot()).toBe("none");
});

test("an answer shows its markdown, and only the text of its links and images", async ({ page, api }) => {
  const markdown = [
    "# Your records",
    "Here are your **records**:",
    "- First record: 3 items\n- Second record: 5 items",
    "See [the guide](https://example.com/guide) and `R-1001`.",
    "![logo](https://example.com/logo.png)",
  ].join("\n\n");
  api.reply(INVOKE, run(MODEL, said(markdown)));
  await page.goto("/");
  await ask(page, QUESTION);

  const answer = page.locator(ANSWER_TEXT);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer).toContainText("Your records");
  await expect(answer.locator("> p")).toHaveText(["Here are your records:", "See the guide and R-1001.", ""]);
  await expect(answer.locator("strong")).toHaveText("records");
  await expect(answer.locator("li")).toHaveText(["First record: 3 items", "Second record: 5 items"]);
  await expect(answer.locator("h1")).toHaveText("Your records");
  await expect(answer.locator("code")).toHaveText("R-1001");
  await expect(answer.locator("a, img")).toHaveCount(0);
});

test("an answer's script tag, event handler and javascript: link show as text and never run", async ({ page, api }) => {
  const markdown = [
    "<script>window.ran = 'script'</script>",
    "<img src=\"missing.png\" onerror=\"window.ran = 'onerror'\">",
    "[Open your file](javascript:window.ran='link')",
  ].join("\n\n");
  api.reply(INVOKE, run(MODEL, said(markdown)));
  await page.goto("/");
  await ask(page, QUESTION);

  const answer = page.locator(ANSWER_TEXT);
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer).toContainText("<script>window.ran = 'script'</script>");
  await expect(answer).toContainText("onerror=");
  await expect(answer.locator("script, img, a, [onerror]")).toHaveCount(0);
  await answer.getByText("Open your file").click();
  expect(await page.evaluate(() => (window as { ran?: string }).ran)).toBeUndefined();
});

test("Stop ends the answer on screen, keeps its text and steps, and Send works again", async ({ page, api }) => {
  api.reply(
    INVOKE,
    sse([
      { type: "run.started" },
      MODEL,
      ...narrated(1, NOTE),
      step("call_1", READ_STEP),
      { type: "delta", content: "Your open" },
    ]),
    run(said(ANSWER)),
  );
  const replay = await holdReplay(page);
  const stops: { url: string; body: unknown; routingKey: string | undefined }[] = [];
  await page.route("**/api/invocations/*/cancel", (route) => {
    const request = route.request();
    stops.push({ url: request.url(), body: request.postDataJSON(), routingKey: request.headers()["x-routing-key"] });
    return route.fulfill(ok({ stopped: true }));
  });
  const aborted: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/invocations")) aborted.push(request.url());
  });
  await page.goto("/");
  await ask(page, QUESTION);

  const stop = page.getByRole("button", { name: "Stop generating" });
  await expect(stop).toBeVisible();
  await replay();
  await stop.click();

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply).toHaveAttribute("data-status", "incomplete");
  await expect(reply.locator(ANSWER_TEXT)).toHaveText("Your open");
  await expect(reply.locator('[data-slot="stopped-run"]')).toContainText(STOPPED);
  await expect(reply.locator(LOADER)).toHaveCount(0);
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeFocused();
  await expect(stop).toHaveCount(0);
  await openWork(reply);
  await expect(reply.locator(STEP)).toHaveAttribute("data-state", "stopped");
  await expect(reply.locator(STEP)).toContainText(`${READ_STEP}, Stopped`);
  await expect.poll(() => aborted.length).toBe(1);
  await expect.poll(() => stops.length).toBe(1);
  const invocationId = api.posted(INVOKE)[0].id;
  expect(stops[0]).toEqual({
    url: expect.stringContaining(`/api/invocations/${invocationId}/cancel`),
    body: { session_id: "c1" },
    routingKey: "c1",
  });
  await checkScreen(page, "answer-stopped");

  await ask(page, "What are my records?");
  await expect(page.locator(ASSISTANT_MESSAGE).last().locator(ANSWER_TEXT)).toHaveText(ANSWER);
  expect(api.posted(INVOKE)).toHaveLength(2);
  expect(aborted).toHaveLength(1);
});

test("Continue after Stop replaces the stopped turn and shows no branch picker", async ({ page, api }) => {
  api.reply(
    INVOKE,
    sse([{ type: "run.started" }, MODEL, step("call_1", READ_STEP), { type: "delta", content: "Your open" }]),
    run(said(ANSWER)),
  );
  const replay = await holdReplay(page);
  await page.goto("/");
  await ask(page, QUESTION);
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await replay();
  await page.getByRole("button", { name: "Stop generating" }).click();
  await page.locator('[data-slot="stopped-run"]').getByRole("button", { name: "Continue" }).click();

  await expect(page.locator(ASSISTANT_MESSAGE).last().locator(ANSWER_TEXT)).toHaveText(ANSWER);
  expect(api.posted(INVOKE).map((body) => body.input)).toEqual([asked(QUESTION), { ...asked(QUESTION), replace: true }]);
  await expect(page.getByRole("button", { name: /^(Previous|Next)$/ })).toHaveCount(0);
  await expect(page.locator(VIEWPORT)).not.toContainText(/\d \/ \d/);
  await checkScreen(page, "answer-continued");
});

test("a reopened conversation shows a run the user stopped as stopped", async ({ page, api }) => {
  const runs = storedRuns({
    id: "inv-1",
    input: asked(QUESTION),
    events: whole(MODEL, ...narrated(1, NOTE), { type: "delta", content: "Your open" }, { type: "stopped" }),
  });
  api.reply(CONVERSATION, conversation({ runs }));
  await page.goto("/#/assistant/c1");

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply).toHaveAttribute("data-status", "incomplete");
  await expect(reply.locator(ANSWER_TEXT)).toHaveText("Your open");
  await expect(reply.locator('[data-slot="stopped-run"]')).toContainText(STOPPED);
});

test("a decision on its way can't be stopped", async ({ page, api }) => {
  api.reply(INVOKE, proposed("rename_record", RENAME));
  await page.goto("/");
  await ask(page, RENAME_QUESTION);
  const card = page.getByTestId("confirm-card");
  await expect(card.getByRole("button", APPROVE)).toBeVisible();
  let decision: Route | undefined;
  await page.route(
    "**/api/invocations",
    (route) => {
      decision = route;
    },
    { times: 1 },
  );
  await card.getByRole("button", APPROVE).click();

  await expect.poll(() => decision).toBeDefined();
  await expect(card).toContainText("Sending your decision");
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).press("Escape");
  await expect(card).toContainText("Sending your decision");
  await decision?.fulfill(decided("rename_record", "allowed", { status: "OK", reference: "REF-7" }));
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText("Change completed. Your reference is REF-7.");
});

test("leaving a conversation mid-answer stops reading it, and coming back follows the run after what it showed", async ({
  page,
  api,
}) => {
  const shown = [{ type: "run.started" }, MODEL, ...narrated(1, NOTE), step("call_1", READ_STEP)];
  api.reply(INVOKE, sse(shown));
  const replay = await holdReplay(page);
  const stops: { url: string; body: unknown; routingKey: string | undefined }[] = [];
  await page.route("**/api/invocations/*/cancel", (route) => {
    const request = route.request();
    stops.push({ url: request.url(), body: request.postDataJSON(), routingKey: request.headers()["x-routing-key"] });
    return route.fulfill(ok({ stopped: true }));
  });
  const aborted: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/invocations")) aborted.push(request.url());
  });
  await page.goto("/");
  await ask(page, QUESTION);
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await replay();

  await page.evaluate(() => {
    window.location.hash = "#/assistant";
  });
  await expect(page.getByRole("button", { name: SUGGESTIONS[0].label })).toBeVisible();
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill("Hello");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect.poll(() => aborted.length).toBe(1);
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill("");

  const id = api.posted(INVOKE)[0].id;
  await page.unroute("**/api/invocations/*/events*");
  const resume = await hold(page, `**/api/invocations/${id}/events*`);
  const runs = storedRuns({ id, input: asked(QUESTION), events: shown });
  api.reply(CONVERSATION, conversation({ runs, running: { id, status: "active" } }));
  await page.evaluate(() => {
    window.location.hash = "#/assistant/c1";
  });

  await expect(page.locator(USER_MESSAGE)).toHaveText(QUESTION);
  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply.locator('[data-slot="run-note"]')).toHaveText(STILL_WRITING);
  await expect(page.locator(ANNOUNCER)).toHaveText(READ_STEP);
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await expect(reply.locator(NOTE_TEXT)).toHaveText([NOTE]);
  await expect(reply.locator(STEP)).toHaveAttribute("data-state", "running");
  const resumed = await resume();
  expect(new URL(resumed.request().url()).searchParams.get("after")).toBe(String(shown.length));
  await replayed(resumed, [
    called("read_records", "user", "test_data.records", "allowed", { call_id: "call_1" }),
    stepDone("call_1"),
    ...said(ANSWER),
    { type: "run.completed" },
  ]);

  await expect(reply.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await expect(reply.locator(STEPS).getByRole("button", STEPS_TOGGLE)).toHaveAccessibleName("Used 1 tool");
  await expect(reply.locator('[data-slot="run-note"]')).toHaveCount(0);
  await expect(page.locator(ANNOUNCER)).toHaveText(ANSWER);
  expect(api.posted(INVOKE)).toHaveLength(1);
});

test("a reload while an answer is being written follows it, and shows its card once", async ({ page, api }) => {
  const card = { proposal_id: "p1", action: "rename_record", args: RENAME };
  const shown = [{ type: "run.started" }, MODEL, step("call_1", RENAME_STEP), { type: "confirmation_required", ...card }];
  const runs = storedRuns({ id: "inv-1", input: asked(QUESTION), events: shown });
  api.reply(CONVERSATION, conversation({ runs, running: { id: "inv-1", status: "active" } }));
  const resume = await hold(page, "**/api/invocations/inv-1/events*");
  await page.goto("/#/assistant/c1");

  const reply = page.locator(ASSISTANT_MESSAGE).last();
  await expect(reply.locator('[data-slot="run-note"]')).toHaveText(STILL_WRITING);
  await expect(page.getByTestId("confirm-card")).toHaveCount(1);
  await checkScreen(page, "answer-still-writing");
  await replayed(await resume(), [{ type: "confirmation_required", ...card }, stepDone("call_1"), ...said(WAITING), { type: "run.completed" }]);

  await expect(reply.locator(ANSWER_TEXT)).toHaveText(WAITING);
  await expect(reply.locator('[data-slot="run-note"]')).toHaveCount(0);
  await expect(page.getByTestId("confirm-card")).toHaveCount(1);
});

test("a reload shows a change still waiting for a decision, and confirming it sends one decision", async ({
  page,
  api,
}) => {
  const proposal = { proposal_id: "p1", action: "rename_record", args: RENAME };
  const events = whole(MODEL, step("call_1", RENAME_STEP), { type: "confirmation_required", ...proposal }, stepDone("call_1"), said(WAITING));
  const runs = storedRuns({ id: "inv-1", input: asked(RENAME_QUESTION), events });
  api.reply(CONVERSATION, conversation({ runs }));
  api.reply(
    INVOKE,
    decided("rename_record", "allowed", { status: "OK", reference: "REF-7" }, "Change completed. Your reference is REF-7."),
  );
  await page.goto("/#/assistant/c1");

  const card = page.getByTestId("confirm-card");
  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Waiting for your confirmation");
  await expect(card.getByRole("heading", { name: CARD_TITLE })).toBeVisible();
  await checkScreen(page, "reloaded-card");
  await card.getByRole("button", APPROVE).click();

  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText("Change completed. Your reference is REF-7.");
  expect(api.posted(INVOKE)).toHaveLength(1);
  expect(api.posted(INVOKE)[0]).toMatchObject({
    session_id: "c1",
    input: { confirm: { proposal_id: "p1", decision: "approve" } },
  });
});

test("a reopened conversation shows each answer as it was shown, with its notes, steps and decided card", async ({
  page,
  api,
}) => {
  const card = { proposal_id: "p1", action: "archive_record", args: ARCHIVE };
  const done = "Change completed. Your reference is REF-1.";
  const runs = storedRuns(
    {
      id: "inv-1",
      input: asked(QUESTION),
      events: whole(
        { type: "received", at: "2026-10-12T09:30:00.000+00:00" },
        MODEL,
        narrated(1, NOTE),
        stepped("call_1", READ_STEP, called("read_records", "user", "test_data.records", "allowed")),
        said(ANSWER),
      ),
    },
    {
      id: "inv-2",
      input: asked(ARCHIVE_QUESTION),
      events: whole(MODEL, step("call_2", ARCHIVE_STEP), { type: "confirmation_required", ...card }, stepDone("call_2"), said(WAITING)),
    },
    {
      id: "inv-3",
      input: { confirm: { proposal_id: "p1", decision: "approve" } },
      events: whole(
        called("archive_record", "user", "agent_ops.archive_record", "allowed", {
          proposal_id: "p1",
          status: "OK",
          reference: "REF-1",
        }),
        said(done),
      ),
    },
  );
  api.reply(CONVERSATION, conversation({ runs }));
  await page.goto("/#/assistant/c1");

  const questions = page.locator(USER_MESSAGE);
  await expect(questions.locator(QUESTION_TEXT)).toHaveText([QUESTION, ARCHIVE_QUESTION]);
  const replies = page.locator(ASSISTANT_MESSAGE);
  await expect(replies).toHaveCount(2);
  const answer = replies.nth(0);
  await expect(answer.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  const toggle = answer.locator(STEPS).getByRole("button", STEPS_TOGGLE);
  await expect(toggle).toHaveAccessibleName("Used 1 tool");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await openWork(answer);
  await expect(answer.locator(NOTE_TEXT)).toHaveText([NOTE]);
  await expect(answer.locator(STEP)).toHaveAttribute("data-state", "done");
  const archive = replies.nth(1);
  await expect(archive.locator(ANSWER_TEXT)).toHaveText(WAITING);
  const decided = archive.getByTestId("confirm-card");
  await expect(decided.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Completed");
  await expect(decided.locator('[data-slot="approval-card-receipt"]')).toHaveText(done);
  await expect(decided.getByRole("button")).toHaveCount(0);
  await expect(page.locator(ANNOUNCER)).toHaveText("");
  await checkScreen(page, "reopened-conversation");
  expect(api.calls).not.toContain(INVOKE);
});

test("a reopened conversation shows a cancelled card as not changed and an open card as waiting", async ({ page, api }) => {
  const decided = { proposal_id: "p1", action: "archive_record", args: ARCHIVE };
  const open = { proposal_id: "p2", action: "rename_record", args: RENAME };
  const runs = storedRuns(
    { id: "inv-1", input: asked(ARCHIVE_QUESTION), events: whole(MODEL, { type: "confirmation_required", ...decided }, called("archive_record", "user", "agent_ops.archive_record", "rejected_by_user", { proposal_id: "p1" }), said("Cancelled. Nothing was changed.")) },
    { id: "inv-2", input: asked(RENAME_QUESTION), events: whole(MODEL, { type: "confirmation_required", ...open }, said(WAITING)) },
  );
  api.reply(CONVERSATION, conversation({ runs }));
  await page.goto("/#/assistant/c1");

  const cards = page.getByTestId("confirm-card");
  await expect(cards.nth(0).locator('[data-slot="approval-card-subtitle"]')).toHaveText("Not changed");
  await expect(cards.nth(0).locator('[data-slot="approval-card-receipt"]')).toHaveText("Nothing was changed.");
  await expect(cards.nth(0).getByRole("button")).toHaveCount(0);
  await expect(cards.nth(1).locator('[data-slot="approval-card-subtitle"]')).toHaveText("Waiting for your confirmation");
  await expect(cards.nth(1).getByRole("button", APPROVE)).toBeEnabled();
});

test("a reopened run that failed shows its error, and Try again asks the question again", async ({ page, api }) => {
  const events = [{ type: "run.started" }, MODEL, step("call_1", READ_STEP), { type: "run.failed" }];
  api.reply(CONVERSATION, conversation({ runs: storedRuns({ id: "inv-1", input: asked(QUESTION), events }) }));
  api.reply(INVOKE, run(MODEL, said(ANSWER)));
  await page.goto("/#/assistant/c1");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("We couldn't complete your request. Try again.");
  const reply = page.locator(ASSISTANT_MESSAGE);
  await openWork(reply);
  await expect(reply.locator(STEP)).toHaveCount(1);
  await expect(reply.locator(".animate-spin")).toHaveCount(0);
  await alert.getByRole("button", { name: "Try again" }).click();

  await expect(reply.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await expect(page.locator(USER_MESSAGE)).toHaveCount(1);
  expect(api.posted(INVOKE)).toHaveLength(1);
  expect(api.posted(INVOKE)[0]).toMatchObject({ session_id: "c1", input: asked(QUESTION) });
});

test("a reopened decision whose outcome is unknown offers Try again with the same decision", async ({ page, api }) => {
  const card = { proposal_id: "p1", action: "rename_record", args: RENAME };
  const decision = { confirm: { proposal_id: "p1", decision: "approve" } };
  const runs = storedRuns(
    { id: "inv-1", input: asked(RENAME_QUESTION), events: whole(MODEL, { type: "confirmation_required", ...card }, said(WAITING)) },
    {
      id: "inv-2",
      input: decision,
      events: [
        { type: "run.started" },
        called("rename_record", "user", "agent_ops.rename_record", "failed", { error: RAW_ERROR }),
        ...said(OUTCOME_UNKNOWN),
        { type: "run.failed" },
      ],
    },
  );
  api.reply(CONVERSATION, conversation({ runs }));
  api.reply(INVOKE, decided("rename_record", "allowed", { status: "OK", reference: "REF-7" }, "Change completed. Your reference is REF-7."));
  await page.goto("/#/assistant/c1");

  const shown = page.getByTestId("confirm-card");
  await expect(shown).toContainText("We couldn't confirm the outcome. Use Try again below; the change won't be made twice.");
  await expect(shown.getByRole("button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("MODIFY");
  await page.getByRole("alert").getByRole("button", { name: "Try again" }).click();

  await expect(shown.locator('[data-slot="approval-card-receipt"]')).toHaveText("Change completed. Your reference is REF-7.");
  expect(api.posted(INVOKE)).toHaveLength(1);
  expect(api.posted(INVOKE)[0].input).toEqual(decision);
});

test("approving a change ends in Done with the reference", async ({ page, api }) => {
  api.reply(
    INVOKE,
    proposed("archive_record", ARCHIVE),
    decided("archive_record", "allowed", { status: "OK", reference: "REF-1" }, "Change completed. Your reference is REF-1."),
  );
  await page.goto("/");
  await ask(page, ARCHIVE_QUESTION);

  const card = page.getByTestId("confirm-card");
  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Waiting for your confirmation");
  await expect(card.getByRole("heading", { name: CARD_TITLE })).toBeVisible();
  await expect(card).toContainText("Nothing changes until you confirm.");
  await expect(card.locator('[data-slot="approval-card-detail"]')).toHaveText([
    "Record idR-1002",
  ]);
  await checkScreen(page, "confirm-pending");

  await card.getByRole("button", APPROVE).click();
  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Completed");
  const result = card.locator('[data-slot="approval-card-receipt"]');
  await expect(result).toHaveText("Change completed. Your reference is REF-1.");
  await expect(result).toBeFocused();
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(1);
  await expect(page.getByText("Change completed. Your reference is REF-1.")).toHaveCount(1);
  expect(api.posted(INVOKE)[1]).toMatchObject({
    session_id: "c1",
    input: { confirm: { proposal_id: "p1", decision: "approve" } },
  });
  await checkScreen(page, "confirm-done");
});

test("Cancel ends in Not changed", async ({ page, api }) => {
  api.reply(
    INVOKE,
    proposed("rename_record", RENAME),
    decided("rename_record", "rejected_by_user", {}, "Cancelled. Nothing was changed."),
  );
  await page.goto("/");
  await ask(page, RENAME_QUESTION);

  const card = page.getByTestId("confirm-card");
  await expect(card.getByRole("heading", { name: CARD_TITLE })).toBeVisible();
  await expect(card.locator('[data-slot="approval-card-detail"]')).toHaveText([
    "Record idR-1001",
    "NameArchive",
  ]);
  await card.getByRole("button", { name: "Cancel" }).click();

  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Not changed");
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText("Nothing was changed.");
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("Nothing was changed.")).toHaveCount(1);
  expect(api.posted(INVOKE)[1].input).toEqual({ confirm: { proposal_id: "p1", decision: "reject" } });
  await checkScreen(page, "confirm-not-changed");
});

test("a rule ends in Not changed with the rule", async ({ page, api }) => {
  const rule = "Names must be unique.";
  api.reply(
    INVOKE,
    proposed("rename_record", RENAME),
    decided("rename_record", "denied", { status: "REJECTED", error: rule }, `${rule} Nothing was changed.`),
  );
  await page.goto("/");
  await ask(page, RENAME_QUESTION);
  const card = page.getByTestId("confirm-card");
  await card.getByRole("button", APPROVE).click();

  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Not changed");
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText(rule);
  await expect(page.locator("body")).not.toContainText("Nothing was changed.");
});

test("any other refusal ends in a plain Not changed", async ({ page, api }) => {
  api.reply(
    INVOKE,
    proposed("rename_record", RENAME),
    decided(
      "rename_record",
      "denied",
      { status: "DENIED", error: RAW_ERROR },
      "This change isn't permitted for you. Nothing was changed.",
    ),
  );
  await page.goto("/");
  await ask(page, RENAME_QUESTION);
  const card = page.getByTestId("confirm-card");
  await card.getByRole("button", APPROVE).click();

  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Not changed");
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText("This change isn't permitted for you.");
  await expect(page.locator("body")).not.toContainText("You don't have permission");
  await expect(page.locator("body")).not.toContainText("MODIFY");
});

test("a decision that ends without an outcome shows the reply and the card open again", async ({ page, api }) => {
  const reply = "We couldn't find that change. Nothing was changed.";
  api.reply(INVOKE, proposed("rename_record", RENAME), run(said(reply)));
  await page.goto("/");
  await ask(page, RENAME_QUESTION);
  const card = page.getByTestId("confirm-card");
  await card.getByRole("button", APPROVE).click();

  await expect(page.locator(ASSISTANT_MESSAGE).last().locator(ANSWER_TEXT)).toHaveText(reply);
  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Waiting for your confirmation");
  await expect(card.getByRole("button", APPROVE)).toBeEnabled();
});

test("Try again after a failed decision sends the same decision", async ({ page, api }) => {
  api.reply(
    INVOKE,
    proposed("rename_record", RENAME),
    sse([
      { type: "run.started" },
      called("rename_record", "user", "agent_ops.rename_record", "failed", { error: RAW_ERROR }),
      ...said(OUTCOME_UNKNOWN),
      { type: "run.failed" },
    ]),
    decided("rename_record", "allowed", { status: "OK", reference: "REF-7" }, "Change completed. Your reference is REF-7."),
  );
  await page.goto("/");
  await ask(page, RENAME_QUESTION);
  const card = page.getByTestId("confirm-card");
  await card.getByRole("button", APPROVE).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("We couldn't complete your request. Try again.");
  await expect(card).toContainText("We couldn't confirm the outcome. Use Try again below; the change won't be made twice.");
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(page.locator(ASSISTANT_MESSAGE).last().locator(ANSWER_TEXT)).toHaveText(OUTCOME_UNKNOWN);
  await expect(page.locator("body")).not.toContainText("MODIFY");
  await checkScreen(page, "confirm-failed");
  await alert.getByRole("button", { name: "Try again" }).click();

  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText("Change completed. Your reference is REF-7.");
  await expect(alert).toHaveCount(0);
  const [, first, again] = api.posted(INVOKE);
  expect(again.input).toEqual(first.input);
  expect(again.id).not.toBe(first.id);
});

for (const { name, reply } of [
  { name: "a failed run", reply: sse([{ type: "run.started" }, { type: "run.failed" }]) },
  { name: "a server error", reply: failed(500) },
]) {
  test(`${name} shows a plain error, and Try again sends the question once more`, async ({ page, api }) => {
    api.reply(INVOKE, reply, run(said(ANSWER)));
    await page.goto("/");
    await ask(page, QUESTION);

    const alert = page.locator(ASSISTANT_MESSAGE).getByRole("alert");
    await expect(alert).toContainText("We couldn't complete your request. Try again.");
    await checkScreen(page, "answer-failed");

    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(1);
    await expect(page.locator(USER_MESSAGE)).toHaveCount(1);
    const [first, again] = api.posted(INVOKE);
    expect(again.input).toEqual(first.input);
    expect(again.id).not.toBe(first.id);
    expect(api.posted("POST /api/sessions")).toHaveLength(1);
  });
}

test("a stream that the replays can't finish shows the plain error", async ({ page, api }) => {
  let replays = 0;
  api.reply(INVOKE, sse([{ type: "run.started" }, { type: "delta", content: "Your open" }]));
  await page.route("**/api/invocations/*/events*", (route) => {
    replays += 1;
    return route.fulfill(sse([]));
  });
  await page.goto("/");
  await ask(page, QUESTION);

  await expect(page.getByRole("alert")).toContainText("We couldn't complete your request. Try again.");
  expect(replays).toBe(3);
});

test("a stream that goes silent is replayed without an error", async ({ page, api }) => {
  await page.clock.install();
  let question: Route | undefined;
  await page.route(
    "**/api/invocations",
    (route) => {
      question = route;
    },
    { times: 1 },
  );
  const replays: string[] = [];
  await page.route("**/api/invocations/*/events*", (route) => {
    replays.push(route.request().url());
    return route.fulfill(run(MODEL, said(ANSWER)));
  });
  await page.goto("/");
  await ask(page, QUESTION);
  await expect.poll(() => question).toBeDefined();

  await page.clock.fastForward(74_000);
  expect(replays).toHaveLength(0);
  await page.clock.fastForward(1_000);

  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  expect(replays).toHaveLength(1);
  expect(new URL(replays[0]).searchParams.get("after")).toBe("0");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a replay that keeps failing is retried after 1 s and 2 s, then says the connection was lost", async ({
  page,
  api,
}) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, { type: "delta", content: "Your open" }]));
  const replays: number[] = [];
  await page.route("**/api/invocations/*/events*", (route) => {
    replays.push(Date.now());
    return route.abort("connectionreset");
  });
  await page.goto("/");
  await ask(page, QUESTION);

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your connection was interrupted. Check your internet connection and try again.", { timeout: 10_000 });
  expect(replays).toHaveLength(3);
  expect(replays[1] - replays[0]).toBeGreaterThanOrEqual(950);
  expect(replays[2] - replays[1]).toBeGreaterThanOrEqual(1_950);
  await expect(alert.getByRole("button", { name: "Try again" })).toBeEnabled();
  await checkScreen(page, "answer-connection-lost");
});

test("after a lost connection, Try again follows the run still going instead of asking again", async ({
  page,
  context,
  api,
}) => {
  const first = [
    { type: "run.started" },
    MODEL,
    ...narrated(1, NOTE),
    step("call_1", READ_STEP),
    { type: "delta", content: "Your open" },
  ];
  api.reply(INVOKE, sse(first));
  const replays: Route[] = [];
  await page.route("**/api/invocations/*/events*", async (route) => {
    replays.push(route);
    if (replays.length > 1) return;
    await context.setOffline(true);
    await route.abort("internetdisconnected");
  });
  await page.goto("/");
  await ask(page, QUESTION);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your connection was interrupted. Check your internet connection and try again.");

  await context.setOffline(false);
  const id = api.posted(INVOKE)[0].id;
  api.reply(CONVERSATION, conversation({ running: { id, status: "active" } }));
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => replays.length).toBe(2);
  expect(replays[1].request().url()).toContain(`/api/invocations/${id}/events`);
  expect(new URL(replays[1].request().url()).searchParams.get("after")).toBe(String(first.length));
  await replayed(replays[1], [
    called("read_records", "user", "test_data.records", "allowed", { call_id: "call_1" }),
    stepDone("call_1"),
    { type: "delta", content: " records hold" },
    { type: "message", message: { role: "assistant", content: ANSWER } },
    { type: "run.completed" },
  ]);

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply).toHaveCount(1);
  await expect(reply).toHaveAttribute("data-status", "complete");
  await expect(reply.locator(ANSWER_TEXT)).toHaveText([ANSWER]);
  await openWork(reply);
  await expect(reply.locator(NOTE_TEXT)).toHaveText([NOTE]);
  await expect(reply.locator(STEP)).toHaveAttribute("data-state", "done");
  expect(api.posted(INVOKE)).toHaveLength(1);
});

test("after a lost connection, Try again asks once more when the run is no longer going", async ({
  page,
  context,
  api,
}) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, { type: "delta", content: "Your open" }]), run(MODEL, said(ANSWER)));
  let replays = 0;
  await page.route("**/api/invocations/*/events*", async (route) => {
    replays += 1;
    await context.setOffline(true);
    await route.abort("internetdisconnected");
  });
  await page.goto("/");
  await ask(page, QUESTION);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your connection was interrupted. Check your internet connection and try again.");

  await context.setOffline(false);
  api.reply(CONVERSATION, conversation());
  await alert.getByRole("button", { name: "Try again" }).click();
  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply).toHaveCount(1);
  await expect(reply).toHaveAttribute("data-status", "complete");
  await expect(reply.locator(ANSWER_TEXT)).toHaveText([ANSWER]);
  expect(api.calls).toContain(CONVERSATION);
  expect(api.posted(INVOKE)).toHaveLength(2);
  expect(api.posted(INVOKE)[1].input).toEqual(asked(QUESTION));
  expect(replays).toBe(1);
});

test("offline, a question says the connection was lost", async ({ page, context, api }) => {
  await page.goto("/");
  await context.setOffline(true);
  await page.route("**/api/invocations", (route) => route.abort("internetdisconnected"));
  await ask(page, QUESTION);

  await expect(page.getByRole("alert")).toContainText("Your connection was interrupted. Check your internet connection and try again.");
  await context.setOffline(false);
});

test("a conversation that can't be created over a lost connection says the connection was lost", async ({ page, api }) => {
  await page.goto("/");
  await page.route("**/api/sessions", (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.fallback(),
  );
  await ask(page, QUESTION);

  await expect(page.getByRole("alert")).toContainText("Your connection was interrupted. Check your internet connection and try again.");
  expect(api.calls).not.toContain("POST /api/invocations");
});

test("a conversation the server can't create says the request couldn't be completed", async ({ page, api }) => {
  api.reply("POST /api/sessions", failed(500));
  await page.goto("/");
  await ask(page, QUESTION);

  await expect(page.getByRole("alert")).toContainText("We couldn't complete your request. Try again.");
  expect(api.calls).not.toContain("POST /api/invocations");
});

test("a replay that sends earlier events again shows their text once", async ({ page, api }) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, { type: "delta", content: "Hello " }]));
  const replays: Route[] = [];
  await page.route("**/api/invocations/*/events*", (route) => {
    replays.push(route);
    if (replays.length === 1) {
      return route.fulfill(sse([{ type: "delta", content: "Hello " }, { type: "delta", content: "world" }], 3));
    }
  });
  await page.goto("/");
  await ask(page, QUESTION);

  await expect.poll(() => replays.length).toBe(2);
  await expect(page.locator(ANSWER_TEXT)).toHaveText("Hello world");
  expect(new URL(replays[0].request().url()).searchParams.get("after")).toBe("3");
  expect(new URL(replays[1].request().url()).searchParams.get("after")).toBe("4");
  await replayed(replays[1], [
    { type: "message", message: { role: "assistant", content: "Hello world" } },
    { type: "run.completed" },
  ]);
  await expect(page.locator(ANSWER_TEXT)).toHaveText("Hello world");
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveAttribute("data-status", "complete");
});

test("a refused model call says the assistant can't answer, without the gateway's reply", async ({ page, api }) => {
  api.reply(
    INVOKE,
    run(
      called("model", "user", "agent_ops.sonnet_llm", "denied", {
        status: "RATE_LIMITED",
        error: "Rate limit exceeded",
      }),
      said("The assistant is unavailable at the moment. Try again in a few minutes."),
    ),
  );
  await page.goto("/");
  await ask(page, QUESTION);

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The assistant is unavailable at the moment. Try again in a few minutes.");
  await expect(page.locator("body")).not.toContainText("Rate limit exceeded");
  await expect(page.locator(ANSWER_TEXT)).toHaveCount(0);
  await checkScreen(page, "answer-refused");
});

test("a model call the user may not make says the assistant isn't available to them", async ({ page, api }) => {
  const notAllowed = `The assistant isn't available for your account. Contact ${SUPPORT_NAME} for help.`;
  api.reply(
    INVOKE,
    run(
      called("model", "user", "agent_ops.sonnet_llm", "denied", {
        status: "NOT_ALLOWED",
        error: "User does not have permission to use model service",
      }),
      said("The assistant isn't available for your account. Contact support for help."),
    ),
  );
  await page.goto("/");
  await ask(page, QUESTION);

  const alert = page.getByRole("alert");
  await expect(alert).toContainText(notAllowed);
  await expect(alert).not.toContainText("Try again in a few minutes");
  await expect(page.locator("body")).not.toContainText("does not have permission");
  await expect(page.locator(ANSWER_TEXT)).toHaveCount(0);
});

test("a 401 while streaming signs the app out", async ({ page, api }) => {
  api.reply(INVOKE, failed(401, "MCP_USER_AUTH_EXPIRED"));
  await page.goto("/");
  await ask(page, QUESTION);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You've been signed out");
  await expect(page.getByText("quote error code USER-AUTH-EXPIRED")).toBeVisible();
});

test("a 502 before any event is retried once with the same invocation ID", async ({ page, api }) => {
  let attempts = 0;
  let firstId: string | undefined;
  let retryId: string | undefined;
  await page.route("**/api/invocations", (route) => {
    attempts += 1;
    const body = route.request().postDataJSON();
    if (attempts === 1) {
      firstId = body.id;
      return route.fulfill(failed(502));
    }
    if (attempts === 2) {
      retryId = body.id;
      return route.fulfill(run(MODEL, said(ANSWER)));
    }
    return route.fulfill(failed(404));
  });
  await page.goto("/");
  await ask(page, QUESTION);

  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  expect(attempts).toBe(2);
  expect(firstId).toBe(retryId);
});

test("a 502 after an event is not retried at the invocation level", async ({ page, api }) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, { type: "delta", content: "Your open" }]));
  let replayCount = 0;
  await page.route("**/api/invocations/*/events*", (route) => {
    replayCount += 1;
    return route.fulfill(sse([]));
  });
  await page.goto("/");
  await ask(page, QUESTION);

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply.locator(ANSWER_TEXT)).toHaveText("Your open");

  await expect(page.getByRole("alert")).toContainText("We couldn't complete your request. Try again.", { timeout: 10_000 });
  expect(replayCount).toBe(3);
});

test("a second 502 on retry surfaces the error", async ({ page, api }) => {
  let attempts = 0;
  await page.route("**/api/invocations", (route) => {
    attempts += 1;
    return route.fulfill(failed(502));
  });
  await page.goto("/");
  await ask(page, QUESTION);

  await expect(page.getByRole("alert")).toContainText("We couldn't complete your request. Try again.");
  expect(attempts).toBe(2);
});

test("a 500 before any event is not retried at the invocation level", async ({ page, api }) => {
  let attempts = 0;
  await page.route("**/api/invocations", (route) => {
    attempts += 1;
    return route.fulfill(failed(500));
  });
  await page.goto("/");
  await ask(page, QUESTION);

  await expect(page.getByRole("alert")).toContainText("We couldn't complete your request. Try again.");
  expect(attempts).toBe(1);
});

test("a POST that drops before any event, then a replay that gets 502, is retried as a drop", async ({ page, api }) => {
  let postAttempts = 0;
  let replayAttempts = 0;
  await page.route("**/api/invocations", (route) => {
    postAttempts += 1;
    if (postAttempts === 1) {
      return route.fulfill(sse([]));
    }
    return route.fulfill(run(MODEL, said(ANSWER)));
  });
  await page.route("**/api/invocations/*/events*", (route) => {
    replayAttempts += 1;
    if (replayAttempts === 1) {
      return route.fulfill(failed(502));
    }
    return route.fulfill(run(MODEL, said(ANSWER)));
  });
  await page.goto("/");
  await ask(page, QUESTION);

  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  expect(postAttempts).toBe(1);
  expect(replayAttempts).toBe(2);
});
