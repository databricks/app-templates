import type { Page, Route } from "@playwright/test";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import {
  ANSWER_TEXT,
  asked,
  ASSISTANT_MESSAGE,
  called,
  checkScreen,
  expect,
  ok,
  run,
  said,
  STOP,
  storedRuns,
  test,
  USER_MESSAGE,
  whole,
} from "./fixtures";

const INVOKE = "POST /api/invocations";
const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");
const QUESTION = "What are my records?";
const ANSWER = "You have 3 records.";
const SUMMARISED = "I summarised our earlier messages, so I read less from now on.";
const USAGE = { type: "usage", requests: 1, input_tokens: 400, output_tokens: 30 };

const input = (page: Page) => page.getByPlaceholder(COMPOSER_PLACEHOLDER);
const ring = (page: Page) => page.getByRole("button", { name: /^Context \d+% full$/ });
const commands = (page: Page) => page.locator('[data-slot="composer-trigger-popover"]');

function opened(page: Page) {
  return page.goto("/#/assistant/c1");
}

test.beforeEach(async ({ api }) => {
  api.reply(
    "GET /api/sessions/c1",
    ok({
      id: "c1",
      title: QUESTION,
      messages: [],
      runs: storedRuns({ id: "r1", input: asked(QUESTION), events: whole(MODEL, said(ANSWER), { ...USAGE, context_tokens: 250_000 }) }),
      running: null,
    }),
  );
});

test("/compact summarises an open conversation without a question, and the thread keeps every message", async ({
  page,
  api,
}) => {
  api.reply(INVOKE, run(MODEL, said(SUMMARISED), USAGE));
  await opened(page);
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await expect(ring(page)).toBeVisible();
  await input(page).fill("/");
  await expect(commands(page)).toContainText("compact");
  await checkScreen(page, "composer-commands");
  await commands(page).getByText("compact").click();
  await expect(page.locator(ASSISTANT_MESSAGE).last().locator(ANSWER_TEXT)).toHaveText(SUMMARISED);
  expect(api.posted(INVOKE).at(-1).input).toEqual({ command: "compact" });
  await expect(input(page)).toHaveValue("");
  await expect(page.locator(USER_MESSAGE)).toHaveCount(1);
  await expect(ring(page)).toHaveCount(0);
});

test("/compact offers no Stop while it runs, and Escape leaves it running", async ({ page, api }) => {
  let compaction: Route | undefined;
  await page.route(
    "**/api/invocations",
    (route) => {
      compaction = route;
    },
    { times: 1 },
  );
  await opened(page);
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await input(page).fill("/");
  await commands(page).getByText("compact").click();
  await expect.poll(() => compaction).toBeDefined();
  await expect(page.locator(ASSISTANT_MESSAGE).last()).toHaveAttribute("data-status", "running");
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  await input(page).press("Escape");
  await compaction?.fulfill(run(MODEL, said(SUMMARISED), USAGE));
  await expect(page.locator(ASSISTANT_MESSAGE).last().locator(ANSWER_TEXT)).toHaveText(SUMMARISED);
  expect(api.calls).not.toContain(STOP);
});

test("a new conversation offers no command yet", async ({ page }) => {
  await page.goto("/");
  await input(page).fill("/");
  await expect(commands(page)).toContainText("Commands work in a conversation, between answers");
});

test("@ offers the data the cards name, and a pick goes into the message as plain text", async ({ page, api }) => {
  api.reply(INVOKE, run(MODEL, said(ANSWER)));
  await opened(page);
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await input(page).fill("Tell me about @");
  const mentions = commands(page);
  await expect(mentions).toBeVisible();
  const first = mentions.getByRole("option").first();
  const label = (await first.textContent())?.trim() ?? "";
  expect(label).not.toBe("");
  await checkScreen(page, "composer-mentions");
  await first.click();
  await expect(input(page)).toHaveValue(new RegExp(`^Tell me about ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await page.getByRole("button", { name: "Send message" }).click();
  expect(api.posted(INVOKE).at(-1).input.messages[0].content).toContain(label);
});
