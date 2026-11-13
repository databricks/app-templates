import type { Page } from "@playwright/test";
import { COMPOSER_PLACEHOLDER, SUGGESTIONS } from "../../src/config/suggestions";
import {
  ANSWER_TEXT,
  asked,
  ASSISTANT_MESSAGE,
  called,
  checkScreen,
  expect,
  failed,
  noContent,
  ok,
  run,
  said,
  storedRuns,
  test,
  whole,
} from "./fixtures";

const INVOKE = "POST /api/invocations";
const FEEDBACK = "POST /api/feedback";
const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");
const BLOCKED = called("model", "user", "agent_ops.sonnet_llm", "denied", { status: "POLICY_BLOCKED" });
const POLICY_TEXT = "Blocked by policy block-unsafe-content.";
const TRACE = { type: "trace", trace_id: "tr-1" };
const QUESTION = "What are my records?";
const ANSWER = "You have 3 records.";

const lastAnswer = (page: Page) => page.locator(ASSISTANT_MESSAGE).last();

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function answered(page: Page): Promise<void> {
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
}

test.beforeEach(async ({ api }) => {
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: QUESTION }), status: 201 });
  api.reply(FEEDBACK, noContent);
});

test("thumbs up rates the answer's run at once, without naming its trace", async ({ page, api }) => {
  api.reply(INVOKE, run(TRACE, MODEL, said(ANSWER)));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  const helpful = lastAnswer(page).getByRole("button", { name: "Helpful", exact: true });
  await helpful.click();
  await expect(helpful).toHaveAttribute("data-submitted", "true");
  const [invocation] = api.posted(INVOKE);
  expect(api.posted(FEEDBACK)).toEqual([{ conversation_id: "c1", run_id: invocation.id, helpful: true }]);
});

test("thumbs down asks why, and sends the reasons and the note as one comment", async ({ page, api }) => {
  api.reply(INVOKE, run(TRACE, MODEL, said(ANSWER)));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  const notHelpful = lastAnswer(page).getByRole("button", { name: "Not helpful" });
  await notHelpful.click();
  await expect(notHelpful).toHaveAttribute("aria-expanded", "true");
  const dialog = page.locator('[data-slot="feedback-dialog"]');
  await dialog.getByRole("button", { name: "Too long" }).click();
  await dialog.getByRole("textbox", { name: "Anything else?" }).fill("Missed my question");
  await checkScreen(page, "feedback-open");
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Thanks. That helps us tune the model.");
  expect(api.posted(FEEDBACK).at(-1)).toMatchObject({ helpful: false, comment: "Too long. Missed my question" });
  await expect(notHelpful).toHaveAttribute("data-submitted", "true");
  await expect(dialog).toBeHidden({ timeout: 5_000 });
});

test("a rating the server refuses shows the answer unrated again", async ({ page, api }) => {
  api.reply(INVOKE, run(TRACE, MODEL, said(ANSWER)));
  api.reply(FEEDBACK, failed(502));
  await page.goto("/");
  await ask(page, QUESTION);
  await answered(page);
  const helpful = lastAnswer(page).getByRole("button", { name: "Helpful", exact: true });
  await helpful.click();
  await expect.poll(() => api.posted(FEEDBACK).length).toBe(1);
  await expect(helpful).not.toHaveAttribute("data-submitted", "true");
});

test("a failed answer, or one still writing, has no thumbs", async ({ page, api }) => {
  await page.route("**/api/invocations/*/events*", () => {});
  api.reply(INVOKE, run(MODEL, { type: "run.failed" }));
  await page.goto("/");
  await ask(page, QUESTION);
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "incomplete");
  await expect(page.getByRole("button", { name: "Helpful", exact: true })).toHaveCount(0);
});

test("a guardrail's block shows its notice instead of the block's text, and a starter question can be asked instead", async ({
  page,
  api,
}) => {
  api.reply(INVOKE, run(BLOCKED, said(POLICY_TEXT)), run(MODEL, said(ANSWER)));
  await page.goto("/");
  await ask(page, QUESTION);
  const notice = page.locator('[data-slot="guardrail-notice"]');
  await expect(notice).toContainText("We can't help with that request.");
  await expect(page.locator("body")).not.toContainText(POLICY_TEXT);
  await expect(page.getByRole("button", { name: "Helpful", exact: true })).toHaveCount(0);
  await checkScreen(page, "guardrail-notice");
  await notice.getByRole("button", { name: SUGGESTIONS[0].prompt }).click();
  await answered(page);
  expect(api.posted(INVOKE).at(-1).input).toEqual(asked(SUGGESTIONS[0].prompt));
});

test("a reopened conversation shows a guardrail's block the same way", async ({ page, api }) => {
  api.reply(
    "GET /api/sessions/c1",
    ok({
      id: "c1",
      title: QUESTION,
      messages: [],
      runs: storedRuns({ id: "r1", input: asked(QUESTION), events: whole(BLOCKED, said(POLICY_TEXT)) }),
      running: null,
    }),
  );
  await page.goto("/#/assistant/c1");
  await expect(page.locator('[data-slot="guardrail-notice"]')).toContainText("We can't help with that request.");
  await expect(page.locator(ANSWER_TEXT)).toHaveCount(0);
});
