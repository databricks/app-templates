import type { Page, Route } from "@playwright/test";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import {
  ANSWER_TEXT,
  asked,
  ASSISTANT_MESSAGE,
  called,
  checkScreen,
  expect,
  failed,
  isPhone,
  ok,
  QUESTION_TEXT,
  type Reply,
  run,
  said,
  STEPS,
  STEPS_TOGGLE,
  storedRuns,
  test,
  USER_MESSAGE,
  whole,
} from "./fixtures";

const INVOKE = "POST /api/invocations";
const CONVERSATION = "GET /api/sessions/c1";
const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");
const QUESTION = "What are my records?";
const ANSWER = "Your open records hold 3 items and your archive holds 12.";
const AGAIN = "You have 3 open records and 12 archived ones.";
const NOW = new Date(2026, 9, 10, 14, 0);
const YESTERDAY = new Date(2026, 9, 9, 9, 30);
const DAY_MS = 86_400_000;

const lastAnswer = (page: Page) => page.locator(ASSISTANT_MESSAGE).last();
const received = (at: Date) => ({ type: "received", at: at.toISOString() });

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function answered(page: Page, text: string): Promise<void> {
  await expect(lastAnswer(page).locator(ANSWER_TEXT)).toHaveText(text);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
}

function conversation(runs: ReturnType<typeof storedRuns>, title = QUESTION): Reply {
  return ok({ id: "c1", title, messages: [], runs, running: null });
}

test.beforeEach(async ({ page, api }) => {
  await page.clock.setFixedTime(NOW);
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: QUESTION }), status: 201 });
});

test("the last answer can be regenerated: it replaces the turn, shows the work time and no branch picker", async ({
  page,
  api,
}) => {
  api.reply(INVOKE, run(MODEL, said(ANSWER)), run({ type: "replaced" }, MODEL, said(AGAIN)));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page, ANSWER);
  await expect(lastAnswer(page).locator('[data-slot="message-timing"]')).toHaveText("worked3s");
  await checkScreen(page, "message-actions");

  await lastAnswer(page).getByRole("button", { name: "Regenerate" }).click();
  await answered(page, AGAIN);
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(1);
  await expect(page.locator(USER_MESSAGE)).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^(Previous|Next)$/ })).toHaveCount(0);
  await expect(page.locator(".aui-thread-followup-suggestions")).toHaveCount(0);
  expect(api.posted(INVOKE)[1].input).toEqual({ ...asked(QUESTION), replace: true });
});

test("only the last question can be edited, and Update replaces its answer", async ({ page, api }) => {
  const edited = "What are my archived records?";
  api.reply(
    INVOKE,
    run(MODEL, said(ANSWER)),
    run(MODEL, said(AGAIN)),
    run({ type: "replaced" }, MODEL, said("Your archive holds 12 records.")),
  );
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page, ANSWER);
  await ask(page, "And the archive?");
  await answered(page, AGAIN);
  const questions = page.locator(USER_MESSAGE);
  await expect(questions.first().getByRole("button", { name: "Edit" })).toHaveCount(0);

  await questions.last().getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("Sending replaces the answer below.")).toBeVisible();
  await page.locator(".aui-edit-composer-input").fill(edited);
  await checkScreen(page, "edit-message");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await answered(page, "Your archive holds 12 records.");
  await expect(questions.locator(QUESTION_TEXT)).toHaveText([QUESTION, edited]);
  expect(api.posted(INVOKE)[2].input).toEqual({ ...asked(edited), replace: true });
});

test("a turn that proposed a change can't be edited or regenerated", async ({
  page,
  api,
}) => {
  const proposal = { type: "confirmation_required", proposal_id: "p1", action: "rename_record", args: { record_id: "R-1001", name: "Archive" } };
  api.reply(INVOKE, run(MODEL, { type: "status", step: "call_1", tool: "rename_record", text: "Preparing the new name" }, proposal, said("It's waiting for your confirmation.")));
  await page.goto("/");
  await ask(page, "Rename record R-1001 to Archive");
  await expect(page.getByTestId("confirm-card")).toBeVisible();
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("a reopened conversation leaves a replaced answer out, marks each day and shows each question's time", async ({
  page,
  api,
}) => {
  const runs = storedRuns(
    { id: "r1", input: asked("Which records do I have?"), events: whole(received(YESTERDAY), MODEL, said("Three open records.")) },
    { id: "r2", input: asked(QUESTION), events: whole(received(NOW), MODEL, said(ANSWER)) },
    { id: "r3", input: { ...asked(QUESTION), replace: true }, events: whole({ type: "replaced" }, received(NOW), MODEL, said(AGAIN)) },
  );
  api.reply(CONVERSATION, conversation(runs));
  await page.goto("/#/assistant/c1");

  await expect(page.locator(ANSWER_TEXT)).toHaveText(["Three open records.", AGAIN]);
  await expect(page.locator('[data-slot="day-separator-header"]')).toHaveText(["Yesterday", "Today"]);
  await expect(page.locator(USER_MESSAGE).locator("time")).toHaveText(["09:30", "14:00"]);
  await checkScreen(page, "day-separator");
});

test("part of an answer can be quoted into the next question, and a reopened conversation shows the quote", async ({
  page,
  api,
}) => {
  const quoted = "3 items";
  const followUp = "Which of them is the oldest?";
  api.reply(INVOKE, run(MODEL, said(ANSWER)), run(MODEL, said("The oldest is R-1001.")));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page, ANSWER);
  await lastAnswer(page)
    .locator(ANSWER_TEXT)
    .locator("p")
    .evaluate((element, text) => {
      const node = element.firstChild as Text;
      const start = (node.textContent ?? "").indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, quoted);
  await expect(page.locator('[data-slot="selection-toolbar"]')).toBeVisible();
  await page.locator('[data-slot="selection-toolbar-quote"]').click();
  await expect(page.locator('[data-slot="composer-quote"]')).toContainText(quoted);
  await checkScreen(page, "quote-preview");
  await ask(page, followUp);

  await answered(page, "The oldest is R-1001.");
  await expect(page.locator(USER_MESSAGE).last().locator('[data-slot="quote-block"]')).toContainText(quoted);
  const sent = `> ${quoted}\n\n${followUp}`;
  expect(api.posted(INVOKE)[1].input).toEqual(asked(sent));

  const runs = storedRuns({ id: "r1", input: asked(sent), events: whole(received(NOW), MODEL, said("The oldest is R-1001.")) });
  api.reply(CONVERSATION, conversation(runs));
  await page.reload();
  await expect(page.locator(USER_MESSAGE).locator(QUESTION_TEXT)).toHaveText(followUp);
  await expect(page.locator('[data-slot="quote-block"]')).toContainText(quoted);
});

test("while an answer runs, only Stop shows, and a question sent with Enter waits in the queue and goes after it", async ({ page, api }) => {
  const second = "And the archive?";
  let held: Route | undefined;
  await page.route("**/api/invocations", (route) => {
    if (held === undefined) held = route;
    else route.fulfill(run(MODEL, said(AGAIN)));
  });
  await page.goto("/");
  await ask(page, QUESTION);
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(second);
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).press("Enter");
  const queue = page.locator('[data-slot="message-queue"]');
  await expect(queue.locator("li")).toHaveCount(1);
  await expect(queue.locator("li")).toContainText(second);
  await checkScreen(page, "message-queue");

  await expect.poll(() => held).toBeDefined();
  await held?.fulfill(run(MODEL, said(ANSWER)));
  await answered(page, AGAIN);
  await expect(page.locator(ANSWER_TEXT)).toHaveText([ANSWER, AGAIN]);
  await expect(queue).toHaveCount(0);
});

test("a failed step says so in the app's words, Retry asks again, and the timeline's label gives the steps' seconds", async ({
  page,
  api,
}) => {
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
  const events = [
    MODEL,
    { type: "status", step: "call_1", tool: "read_records", text: "Looking at your records", at: at(1) },
    called("read_records", "user", "test_data.records", "allowed", { call_id: "call_1" }),
    { type: "step.done", step: "call_1", at: at(2) },
    { type: "status", step: "call_2", tool: "read_records", text: "Looking at your archive", at: at(2) },
    called("read_records", "user", "test_data.archive", "denied", { call_id: "call_2", error: "PERMISSION_DENIED raw" }),
    { type: "step.done", step: "call_2", at: at(3) },
    said(ANSWER),
  ];
  api.reply(INVOKE, run(...events), run({ type: "replaced" }, MODEL, said(AGAIN)));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page, ANSWER);
  const toggle = lastAnswer(page).locator(STEPS).getByRole("button", STEPS_TOGGLE);
  await expect(toggle).toHaveAccessibleName("Used 2 tools · 2s");
  await toggle.click();

  const error = lastAnswer(page).locator('[data-slot="tool-error"]');
  await expect(error).toContainText("This step couldn't finish.");
  await expect(error).not.toContainText("PERMISSION_DENIED");
  await expect(error.getByRole("button", { name: "Skip" })).toHaveCount(0);
  await checkScreen(page, "tool-error");

  await error.getByRole("button", { name: "Retry" }).click();
  await answered(page, AGAIN);
  expect(api.posted(INVOKE)[1].input).toEqual({ ...asked(QUESTION), replace: true });
});

const LISTED = [
  { id: "c1", title: "Records opened this week", last_activity_time: NOW.toISOString() },
  { id: "c2", title: "Archive questions", last_activity_time: new Date(NOW.getTime() - 9 * DAY_MS).toISOString() },
];

test("hovering a conversation shows only that conversation's menu button", async ({ page, api }) => {
  test.skip(isPhone(), "phones have no hover");
  api.reply("GET /api/sessions", ok(LISTED));
  await page.goto("/");
  const items = page.getByRole("navigation", { name: "Conversations" }).locator('[data-slot="aui_thread-list-item"]');
  await items.first().hover();
  const menu = (index: number) => items.nth(index).getByRole("button", { name: /^More actions for/ });
  await expect(menu(0)).toHaveCSS("opacity", "1");
  await expect(menu(1)).toHaveCSS("opacity", "0");
});

test("conversations can be searched by title, and older ones show their date in the list", async ({ page, api }) => {
  api.reply("GET /api/sessions", ok(LISTED));
  api.reply("GET /api/sessions/c2", conversation([], "Archive questions"));
  await page.goto("/");
  if (isPhone()) await page.getByRole("button", { name: "Conversation list" }).click();
  const list = page.getByRole("navigation", { name: "Conversations" });
  await expect(list.locator('[data-slot="aui_thread-list-item-date"]')).toHaveText(["1 October"]);

  await list.getByRole("button", { name: "Search conversations" }).click();
  const search = page.locator('[data-slot="thread-search"]');
  await expect(search.getByRole("option")).toHaveCount(2);
  await checkScreen(page, "thread-search");
  await search.getByRole("combobox").fill("arch");
  await expect(search.getByRole("option")).toHaveText([/Archive questions/]);
  await search.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(/#\/assistant\/c2$/);
});

test("Find in conversation steps through the matches in the open thread's text", async ({ page, api }) => {
  const runs = storedRuns(
    { id: "r1", input: asked(QUESTION), events: whole(received(NOW), MODEL, said(ANSWER)) },
    { id: "r2", input: asked("Which records are archived?"), events: whole(received(NOW), MODEL, said("Twelve records are archived.")) },
  );
  api.reply(CONVERSATION, conversation(runs));
  await page.goto("/#/assistant/c1");
  await expect(page.locator(ANSWER_TEXT)).toHaveCount(2);
  await page.getByRole("button", { name: "Find in conversation" }).click();
  await page.getByRole("textbox", { name: "Find in conversation" }).fill("records");
  const find = page.locator('[data-slot="conversation-search"]');
  await expect(find).toContainText("1/4");
  await checkScreen(page, "find-in-conversation");
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(find).toContainText("2/4");
});

test("the command menu goes to a new conversation, a page or a conversation", async ({ page, api }) => {
  api.reply("GET /api/sessions", ok(LISTED));
  await page.goto("/#/activity");
  await page.getByRole("button", { name: "Commands" }).click();
  const palette = page.locator('[data-slot="command-palette"]');
  await expect(palette.getByRole("group", { name: "Conversations" })).toContainText("Records opened this week");
  await checkScreen(page, "command-palette");
  await palette.getByRole("combobox").fill("Archive");
  await palette.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(/#\/assistant\/c2$/);
  if (!isPhone()) {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible();
  }
});
