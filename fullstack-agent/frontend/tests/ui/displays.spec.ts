import type { Page } from "@playwright/test";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import {
  ANNOUNCER,
  ANSWER_TEXT,
  asked,
  ASSISTANT_MESSAGE,
  called,
  checkScreen,
  expect,
  ok,
  run,
  said,
  sse,
  stepped,
  STEPS_TOGGLE,
  storedRuns,
  test,
  USER_MESSAGE,
  whole,
} from "./fixtures";
import { ACTIVITY } from "./mock-data";

const INVOKE = "POST /api/invocations";
const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");
const QUESTION = "Show me my records";
const ANSWER = "Here they are.";
const SHOW_STEP = "Showing your records";
const OPTIONS = [
  { id: "a", label: "Open records", description: "The 3 you're working on" },
  { id: "b", label: "Archived records", description: "The 12 you put away" },
];
const PLAN_ITEMS = [
  { id: "read", text: "Read your records", status: "done" },
  { id: "compare", text: "Compare them", status: "active" },
];

/** Payloads and elements for each display view. */
const VIEWS: Record<string, { slot: string; payload: Record<string, unknown> }> = {
  table: {
    slot: "data-table",
    payload: {
      title: "Your records",
      columns: [
        { key: "name", label: "Record" },
        { key: "amount", label: "Amount", format: { kind: "currency", currency: "EUR" } },
        { key: "opened", label: "Opened", format: { kind: "date" } },
      ],
      rows: [
        { name: "Archive", amount: "8500.00", opened: "2026-10-01" },
        { name: "A record with a long name that has to wrap on a phone screen", amount: "25.00", opened: "2026-10-09" },
      ],
    },
  },
  number: { slot: "number-ticker", payload: { label: "Records you hold", value: 15 } },
  details: {
    slot: "spec-sheet",
    payload: {
      title: "Archive",
      subtitle: "Opened 1 October",
      rows: [
        { label: "Amount", value: "€8,500.00", emphasis: true },
        { label: "Owner", value: "You", emphasis: false },
      ],
    },
  },
  questions: { slot: "option-list", payload: { questions: [{ id: "which", question: "Which records do you mean?", options: OPTIONS, multiple: false }] } },
  flow: {
    slot: "question-flow",
    payload: {
      questions: [
        { id: "which", question: "Which records do you mean?", options: OPTIONS, multiple: false },
        { id: "when", question: "From when?", options: [{ id: "week", label: "This week", description: "" }, { id: "month", label: "This month", description: "" }], multiple: false },
      ],
    },
  },
  suggestion: { slot: "recommendation-card", payload: { question: "Shall I show the archived ones too?", reason: "You asked about the open ones, and 12 more are archived." } },
  comparison: {
    slot: "comparison-card",
    payload: {
      traitLabels: ["Amount", "Opened"],
      options: [
        { id: "a", name: "Archive", headline: "The larger one", traits: ["€8,500.00", "1 October"] },
        { id: "b", name: "A record with a long name that wraps", headline: "The newer one", traits: ["€25.00", "9 October"] },
      ],
      recommendedId: "",
      reason: "The archive holds more; the other is newer.",
    },
  },
  plan: { slot: "todo-list", payload: { title: "Your records", items: PLAN_ITEMS } },
  report: {
    slot: "research-report",
    payload: {
      title: "Your records",
      sections: [{ id: "a", heading: "Open records", summary: "Three records are open.", sources: ["records"] }],
      sourcesRead: 1,
    },
  },
};

/** Display event for a call. */
function display(call: string, view: string, payload: Record<string, unknown>) {
  return { type: "display", call_id: call, view: view === "flow" ? "questions" : view, payload };
}

/** Run that shows view in its step, then answers. */
function shown(view: string, call = "call_1") {
  const [start, end] = stepped(call, SHOW_STEP);
  return [MODEL, start, display(call, view, VIEWS[view].payload), end, ...said(ANSWER)];
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function answered(page: Page): Promise<void> {
  await expect(page.locator(ASSISTANT_MESSAGE).last()).toHaveAttribute("data-status", "complete");
}

test.beforeEach(async ({ api }) => {
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: QUESTION }), status: 201 });
});

for (const [view, { slot }] of Object.entries(VIEWS)) {
  test(`a ${view} display shows its element after its step, above the answer`, async ({ page, api }) => {
    api.reply(INVOKE, run(shown(view)));
    await page.goto("/");
    await ask(page, QUESTION);
    await answered(page);
    const reply = page.locator(ASSISTANT_MESSAGE);
    const element = reply.locator(`[data-slot="${slot}"]`).first();
    await expect(element).toBeVisible();
    await expect(reply.getByRole("button", STEPS_TOGGLE)).toHaveAccessibleName("Used 1 tool");
    const [elementBox, answerBox] = [await element.boundingBox(), await reply.locator(ANSWER_TEXT).boundingBox()];
    expect(answerBox!.y).toBeGreaterThan(elementBox!.y + elementBox!.height - 1);
    await checkScreen(page, `display-${view}`);
  });
}

test("a display comes back the same in a reopened conversation", async ({ page, api }) => {
  api.reply(
    "GET /api/sessions/c1",
    ok({ id: "c1", title: QUESTION, messages: [], runs: storedRuns({ id: "r1", input: asked(QUESTION), events: whole(shown("table")) }), running: null }),
  );
  await page.goto("/#/assistant/c1");
  await expect(page.locator('[data-slot="data-table"]')).toContainText("Archive");
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
});

test("a picked answer goes as the next question, and the answers then only show", async ({ page, api }) => {
  api.reply(INVOKE, run(shown("questions")), run(MODEL, said(ANSWER)));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  const list = page.locator('[data-slot="option-list"]').first();
  await list.getByRole("button", { name: /Archived records/ }).click();
  await expect(page.locator(USER_MESSAGE).last()).toContainText("Archived records");
  expect(api.posted(INVOKE).at(-1).input).toEqual(asked("Archived records"));
  await answered(page);
  await expect(page.locator('[data-slot="option-list"]').first().getByRole("button")).toHaveCount(0);
});

test("accepting a suggestion says so as the next question", async ({ page, api }) => {
  api.reply(INVOKE, run(shown("suggestion")), run(MODEL, said(ANSWER)));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  await page.getByRole("button", { name: "Accept" }).click();
  expect(api.posted(INVOKE).at(-1).input).toEqual(asked("Yes, go ahead."));
  await expect(page.locator('[data-slot="recommendation-card"]')).toContainText("Accepted");
});

test("a plan shows once, at its first place, with its latest steps", async ({ page, api }) => {
  const latest = PLAN_ITEMS.map((item) => ({ ...item, status: "done" }));
  const [start, end] = stepped("call_2", SHOW_STEP);
  api.reply(INVOKE, run(shown("plan"), start, display("call_2", "plan", { title: "Your records", items: latest }), end));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  await expect(page.locator('[data-slot="todo-list"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="todo-list"]')).toContainText("2/2");
});

test("an answer lists the data it read as sources once it has ended, and its markers as citations", async ({ page, api }) => {
  const { userRead, appRead } = ACTIVITY;
  const source = userRead.target.split(".").at(-1);
  const answer = `You hold 3 records(source:${source}) and nothing else(source:invented).`;
  api.reply(
    INVOKE,
    run(
      MODEL,
      stepped("call_1", userRead.step, called(userRead.tool, "user", userRead.target, "allowed")),
      stepped("call_2", appRead.step, called(appRead.tool, "app", appRead.target, "allowed")),
      stepped("call_3", userRead.step, called(userRead.tool, "user", userRead.target, "allowed")),
      said(answer),
    ),
  );
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  const sources = page.locator('[data-slot="aui_message-sources"]');
  await expect(sources.locator('[data-slot="source-title"]')).toHaveText([userRead.title, appRead.title]);
  const answerText = page.locator(ANSWER_TEXT);
  await expect(answerText).toHaveText("You hold 3 records1 and nothing else.");
  await expect(page.locator(ANNOUNCER)).toHaveText("You hold 3 records and nothing else.");
  await answerText.getByRole("button", { name: `Source 1: ${userRead.title}` }).click();
  await expect(page.getByRole("dialog")).toContainText(userRead.title);
  await checkScreen(page, "sources-citation");
});

test("an answer's sources stay hidden while it streams", async ({ page, api }) => {
  const { userRead } = ACTIVITY;
  await page.route("**/api/invocations/*/events*", () => {});
  api.reply(
    INVOKE,
    sse([{ type: "run.started" }, MODEL, ...stepped("call_1", userRead.step, called(userRead.tool, "user", userRead.target, "allowed")), { type: "delta", content: "You hold" }]),
  );
  await page.goto("/");
  await ask(page, QUESTION);
  await expect(page.locator(ANSWER_TEXT)).toHaveText("You hold");
  await expect(page.locator('[data-slot="aui_message-sources"]')).toBeHidden();
});
