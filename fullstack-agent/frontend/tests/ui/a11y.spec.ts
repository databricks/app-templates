import type { Page, Route } from "@playwright/test";
import {
  ANNOUNCER,
  ANSWER_TEXT,
  ASSISTANT_MESSAGE,
  called,
  checkScreen,
  expect,
  isPhone,
  LOADER,
  narrated,
  ok,
  replayed,
  run,
  said,
  sse,
  step,
  STEP,
  stepDone,
  STEPS,
  STEPS_TOGGLE,
  stepped,
  tabTo,
  test,
  WEBKIT_TABS_TO_FORM_CONTROLS_ONLY,
} from "./fixtures";
import { COMPOSER_PLACEHOLDER, SUGGESTIONS } from "../../src/config/suggestions";
import { ACTIVITY, ME } from "./mock-data";

const NOW = new Date(2026, 9, 10, 14, 0);
const INVOKE = "POST /api/invocations";
const QUESTION = "What are my records and the reference list?";
const ANSWER = "Your open records hold 3 items. The reference list has 12 entries.";
const NOTE = "I'll look at your records and the reference list.";
const MOVE = "Archive record R-1002";
const MOVED = "Change completed. Your reference is REF-1.";
const APPROVE = { name: "Confirm", exact: true };

/** Elements that screen readers announce. */
const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';

const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");

const READ_STEPS = [
  ...narrated(1, NOTE),
  ...stepped("call_1", "Looking at your records", called("read_records", "user", "test_data.records", "allowed")),
  ...stepped("call_2", "Checking the reference list", called("read_reference", "app", "test_reference.items", "allowed")),
];

const READS = run(MODEL, READ_STEPS, said(ANSWER));

const PROPOSED = run(
  MODEL,
  step("call_3", "Preparing to archive your record"),
  {
    type: "confirmation_required",
    proposal_id: "p1",
    action: "archive_record",
    args: { record_id: "R-1002" },
  },
  stepDone("call_3"),
);

const APPROVAL = [
  called("archive_record", "user", "agent_ops.archive_record", "allowed", {
    proposal_id: "p1",
    status: "OK",
    reference: "REF-1",
  }),
  ...said(MOVED),
];

const APPROVED = run(APPROVAL);

/** 80 chars without spaces; hardest case for text wrapping. */
const long = (seed: string) => seed.repeat(80).slice(0, 80);

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

/** Wait for the count-th answer to finish. */
async function answered(page: Page, count = 1): Promise<void> {
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(count);
  await expect(page.locator(ASSISTANT_MESSAGE).last()).toHaveAttribute("data-status", "complete");
}

async function openPage(page: Page, link: string): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: link }).click();
}

test.beforeEach(async ({ api }) => {
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: QUESTION }), status: 201 });
});

test("the open drawer hides the chat behind it from screen readers until it closes", async ({ page }) => {
  test.skip(!isPhone(), "the conversation list is a drawer only on phones");
  await page.goto("/");
  const app = page.locator("#root");
  const toggle = page.getByRole("button", { name: "Conversation list" });
  await expect(app).not.toHaveAttribute("aria-hidden");

  await toggle.click();
  await expect(app).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(app).not.toHaveAttribute("aria-hidden");
  await expect(toggle).toBeFocused();

  await toggle.click();
  await expect(app).toHaveAttribute("aria-hidden", "true");
  await page.locator('[data-slot="sheet-overlay"]').click({ position: { x: 370, y: 400 } });
  await expect(app).not.toHaveAttribute("aria-hidden");
  await expect(toggle).toBeFocused();
});

test("the main tasks work with the keyboard alone", async ({ page, api }, testInfo) => {
  test.skip(testInfo.project.name === "phone-webkit", WEBKIT_TABS_TO_FORM_CONTROLS_ONLY);
  api.reply("GET /api/sessions", ok([{ id: "c0", title: "Earlier records", last_activity_time: NOW.toISOString() }]));
  api.reply(INVOKE, READS, PROPOSED, APPROVED);
  await page.goto("/");

  await tabTo(page, page.getByRole("link", { name: "Skip to main content" }));
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  if (isPhone()) {
    const toggle = page.getByRole("button", { name: "Conversation list" });
    await tabTo(page, toggle);
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("navigation", { name: "Conversations" });
    const controls = drawer.locator("a[href], button, input").filter({ visible: true });
    await expect(controls).toHaveCount(5);
    await expect(controls.first()).toBeFocused();
    for (let presses = 0; presses < 5; presses++) {
      await page.keyboard.press("Tab");
      expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await expect(controls.first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(controls.last()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(toggle).toBeFocused();
  }

  await tabTo(page, page.getByRole("button", { name: SUGGESTIONS[0].label }));
  const composer = page.getByRole("combobox", { name: "Message input" });
  await tabTo(page, composer, "Shift+Tab");
  await page.keyboard.type(QUESTION);
  await page.keyboard.press("Enter");
  await answered(page);

  const steps = page.locator(STEPS);
  const toggle = steps.getByRole("button", STEPS_TOGGLE);
  await tabTo(page, toggle, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(steps.locator(STEP)).toHaveText([/^Looking at your records/, /^Checking the reference list/]);

  await tabTo(page, composer);
  await page.keyboard.type(MOVE);
  await page.keyboard.press("Enter");
  const card = page.getByTestId("confirm-card");
  const approve = card.getByRole("button", APPROVE);
  await expect(approve).toBeEnabled();
  await tabTo(page, approve, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText(MOVED);
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toBeFocused();

  const nav = page.getByRole("navigation", { name: "Main" });
  await tabTo(page, nav.getByRole("link", { name: "Activity" }), "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Assistant activity");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  const changes = page.getByRole("button", { name: "Changes" });
  await tabTo(page, changes);
  await page.keyboard.press("Enter");
  await expect(changes).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-slot="activity-title"]')).toHaveText(["Change completed"]);

  const menuButton = page.getByRole("button", { name: /Account menu/ });
  const menu = page.getByRole("dialog", { name: "Account" });
  await tabTo(page, menuButton, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await checkScreen(page, "keyboard-user-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(menu).toBeFocused();
  await page.mouse.click(8, 300);
  await expect(menu).toBeHidden();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
});

test("from the keyboard, a suggestion, Send, Stop and Try again leave focus in the composer", async ({ page, api }, testInfo) => {
  test.skip(testInfo.project.name === "phone-webkit", WEBKIT_TABS_TO_FORM_CONTROLS_ONLY);
  let replay: Route | undefined;
  api.reply(
    INVOKE,
    READS,
    READS,
    sse([{ type: "run.started" }, { type: "delta", content: "Your open" }]),
    sse([{ type: "run.started" }, { type: "run.failed" }]),
    READS,
  );
  await page.route("**/api/invocations/*/events*", (route) => {
    replay = route;
  });
  await page.goto("/");
  const composer = page.getByRole("combobox", { name: "Message input" });

  await tabTo(page, page.getByRole("button", { name: SUGGESTIONS[0].label }));
  await page.keyboard.press("Enter");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(SUGGESTIONS[0].prompt);
  await page.keyboard.press("Enter");
  await answered(page);

  await page.keyboard.type(QUESTION);
  await tabTo(page, page.getByRole("button", { name: "Send message" }));
  await page.keyboard.press("Enter");
  await expect(composer).toBeFocused();
  await answered(page, 2);

  await page.keyboard.type(QUESTION);
  await page.keyboard.press("Enter");
  await expect.poll(() => replay).toBeDefined();
  await tabTo(page, page.getByRole("button", { name: "Stop generating" }));
  await page.keyboard.press("Enter");
  await expect(composer).toBeFocused();

  await page.keyboard.type(QUESTION);
  await page.keyboard.press("Enter");
  const tryAgain = page.getByRole("button", { name: "Try again" });
  await expect(tryAgain).toBeEnabled();
  await tabTo(page, tryAgain, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(composer).toBeFocused();
  await answered(page, 4);
});

test("from the keyboard, a decision moves focus to its progress, then its result or its failure", async ({
  page,
  api,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone-webkit", WEBKIT_TABS_TO_FORM_CONTROLS_ONLY);
  let replay: Route | undefined;
  const proposedAgain = run(
    MODEL,
    step("call_4", "Preparing to archive your record"),
    {
      type: "confirmation_required",
      proposal_id: "p2",
      action: "archive_record",
      args: { record_id: "R-1002" },
    },
    stepDone("call_4"),
  );
  api.reply(
    INVOKE,
    PROPOSED,
    sse([{ type: "run.started" }]),
    proposedAgain,
    sse([{ type: "run.started" }, { type: "run.failed" }]),
  );
  await page.route("**/api/invocations/*/events*", (route) => {
    replay = route;
  });
  await page.goto("/");
  await ask(page, MOVE);
  const card = page.getByTestId("confirm-card");
  await tabTo(page, card.getByRole("button", APPROVE), "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText("Sending your decision");
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toBeFocused();
  await expect.poll(() => replay).toBeDefined();
  if (replay) await replayed(replay, [...APPROVAL, { type: "run.completed" }]);
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText(MOVED);
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toBeFocused();

  await ask(page, MOVE);
  const second = page.getByTestId("confirm-card").last();
  await tabTo(page, second.getByRole("button", APPROVE), "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(second.locator('[data-slot="approval-card-receipt"]')).toHaveText("We couldn't confirm the outcome. Use Try again below; the change won't be made twice.");
  await expect(second.locator('[data-slot="approval-card-receipt"]')).toBeFocused();
});

test("a finished answer is announced once, and not while it streams", async ({ page, api }) => {
  let replay: Route | undefined;
  api.reply(INVOKE, sse([{ type: "run.started" }, { type: "delta", content: "Your open records" }]));
  await page.route("**/api/invocations/*/events*", (route) => {
    replay = route;
  });
  await page.goto("/");
  const status = page.locator(ANNOUNCER);
  const speaking = page.locator(LIVE).filter({ hasText: /\S/ });
  await ask(page, QUESTION);

  await expect(page.locator(ANSWER_TEXT)).toHaveText("Your open records");
  await expect(speaking).toHaveCount(0);
  await expect(status).toHaveText("");

  await expect.poll(() => replay).toBeDefined();
  if (replay) {
    await replayed(replay, [{ type: "message", message: { role: "assistant", content: ANSWER } }, { type: "run.completed" }]);
  }
  await expect(status).toHaveText(ANSWER);
  await expect(speaking).toHaveCount(1);
});

test("a running and a finished Thinking block pass the screen checks", async ({ page, api }) => {
  let replay: Route | undefined;
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, ...READ_STEPS.slice(0, 4)]));
  await page.route("**/api/invocations/*/events*", (route) => {
    replay = route;
  });
  await page.goto("/");
  await ask(page, QUESTION);

  const steps = page.locator(STEPS);
  await expect(steps.locator(STEP)).toHaveAttribute("data-state", "running");
  await expect(page.locator(LIVE).filter({ hasText: /\S/ })).toHaveCount(1);
  await checkScreen(page, "thinking-running");

  await expect.poll(() => replay).toBeDefined();
  if (replay) await replayed(replay, [...READ_STEPS.slice(4), ...said(ANSWER), { type: "run.completed" }]);
  await answered(page);
  await steps.getByRole("button", STEPS_TOGGLE).click();
  await expect(steps.locator(STEP)).toHaveCount(2);
  await checkScreen(page, "thinking-done");
});

test("a loaded conversation is not announced", async ({ page, api }) => {
  api.reply(
    "GET /api/sessions/c2",
    ok({
      id: "c2",
      title: "Earlier records",
      messages: [
        { role: "user", content: "What is in the reference list?" },
        { role: "assistant", content: ANSWER },
      ],
      runs: [],
      running: null,
    }),
  );
  await page.goto("/#/assistant/c2");
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await expect(page.locator(ANNOUNCER)).toHaveText("");
});

test("a card's result is announced once, by moving focus to it", async ({ page, api }) => {
  api.reply(INVOKE, PROPOSED, APPROVED);
  await page.goto("/");
  await ask(page, MOVE);
  await page.getByTestId("confirm-card").getByRole("button", APPROVE).click();

  const result = page.getByTestId("confirm-card").locator('[data-slot="approval-card-receipt"]');
  await expect(result).toHaveText(MOVED);
  await expect(result).toBeFocused();
  await expect(page.locator(LIVE).filter({ hasText: "REF-1" })).toHaveCount(0);
  await expect(page.locator(ANNOUNCER)).toHaveText("");
});

test("a failed answer is announced once, by its alert", async ({ page, api }) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, { type: "run.failed" }]));
  await page.goto("/");
  await ask(page, QUESTION);

  await expect(page.getByRole("alert")).toContainText("We couldn't complete your request. Try again.");
  await expect(page.locator(LIVE).filter({ hasText: "We couldn't complete your request" })).toHaveCount(1);
});

test("with reduced motion nothing animates", async ({ page, api }) => {
  const animations = () => page.evaluate(() => document.getAnimations().length);
  let question: Route | undefined;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(
    "**/api/invocations",
    (route) => {
      question = route;
    },
    { times: 1 },
  );
  api.reply(INVOKE, PROPOSED);
  await page.goto("/");

  if (isPhone()) {
    await page.getByRole("button", { name: "Conversation list" }).click();
    await expect(page.getByRole("navigation", { name: "Conversations" })).toBeVisible();
    expect(await animations()).toBe(0);
    await page.keyboard.press("Escape");
  }

  await ask(page, QUESTION);
  await expect(page.locator(LOADER)).toBeVisible();
  expect(await animations()).toBe(0);
  await checkScreen(page, "working");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(animations).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(animations).toBe(0);

  await expect.poll(() => question).toBeDefined();
  await question?.fulfill(READS);
  await answered(page);
  await page.locator(STEPS).getByRole("button", STEPS_TOGGLE).click();
  await expect(page.locator(STEPS).locator(STEP)).toHaveCount(2);
  expect(await animations()).toBe(0);

  await ask(page, MOVE);
  await answered(page, 2);
  await page.route("**/api/invocations", () => {});
  await page.getByTestId("confirm-card").getByRole("button", APPROVE).click();
  await expect(page.getByText("Sending your decision")).toBeVisible();
  expect(await animations()).toBe(0);
  await checkScreen(page, "confirm-sending");
});

test("nav links, header buttons and card buttons are at least 44px", async ({ page, api }) => {
  api.reply(INVOKE, PROPOSED);
  await page.goto("/");
  await ask(page, MOVE);
  const buttons = page.getByTestId("confirm-card").getByRole("button");
  await expect(buttons).toHaveCount(2);
  const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  const header = isPhone()
    ? [
        page.getByRole("button", { name: "Conversation list" }),
        page.getByRole("link", { name: "New conversation" }),
        page.getByRole("button", { name: /Account menu/ }),
      ]
    : [];
  for (const target of [...(await links.all()), ...(await buttons.all()), ...header]) {
    const box = await target.boundingBox();
    const name = (await target.getAttribute("aria-label")) ?? (await target.innerText());
    expect(box?.height, name).toBeGreaterThanOrEqual(44);
    expect(box?.width, name).toBeGreaterThanOrEqual(44);
  }
  if (isPhone()) {
    await page.getByRole("button", { name: "Conversation list" }).click();
    const drawer = page.getByRole("navigation", { name: "Conversations" });
    const newButton = drawer.getByRole("button", { name: "New conversation" });
    expect((await newButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test("80-character names and titles wrap without horizontal overflow", async ({ page, api }) => {
  const title = long("Whatarethelatestrecords");
  api.reply("GET /api/me", ok({ ...ME, display_name: long("Maximiliana") }));
  api.reply("GET /api/sessions", ok([{ id: "c1", title, last_activity_time: NOW.toISOString() }]));
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title }), status: 201 });
  api.reply(
    INVOKE,
    run(called(ACTIVITY.userRead.tool, "user", ACTIVITY.userRead.target, "allowed"), said(`Your reference is ${long("REF")}.`)),
    run(
      MODEL,
      step("call_3", "Preparing the new name for your record"),
      { type: "confirmation_required", proposal_id: "p1", action: "rename_record", args: { record_id: "R-1001", name: long("Archive") } },
      stepDone("call_3"),
    ),
  );
  await page.goto("/");
  await checkScreen(page, "long-welcome");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await checkScreen(page, "long-user-menu");
  await page.keyboard.press("Escape");

  await ask(page, title);
  await answered(page);
  await ask(page, "Rename record R-1001");
  await answered(page, 2);
  await expect(page.getByTestId("confirm-card").locator('[data-slot="approval-card-detail"]').last()).toContainText(long("Archive"));
  await checkScreen(page, "long-conversation");
  if (isPhone()) {
    await page.getByRole("button", { name: "Conversation list" }).click();
    await checkScreen(page, "long-conversations");
    await page.keyboard.press("Escape");
  }

  await openPage(page, "Activity");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await checkScreen(page, "long-activity");
  await expect(page.locator('[data-slot="activity-meta"] a')).toHaveText([title]);
});
