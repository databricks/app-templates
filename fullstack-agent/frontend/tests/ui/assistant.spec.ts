import type { Locator, Page, Route } from "@playwright/test";
import { COMPOSER_PLACEHOLDER, SUGGESTIONS } from "../../src/config/suggestions";
import {
  asked,
  ANSWER_TEXT,
  checkScreen,
  expect,
  failed,
  isPhone,
  ok,
  QUESTION_TEXT,
  run,
  said,
  STEPS,
  test,
  USER_MESSAGE,
  VIEWPORT,
} from "./fixtures";
import { ANSWER, ASK_LINKS } from "./mock-data";

const NOW = new Date(2026, 9, 10, 14, 0);
const HOUR_MS = 3_600_000;
const INVOKE = "POST /api/invocations";

const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS).toISOString();

const SESSIONS = [
  { id: "c1", title: "Missing record", last_activity_time: hoursBefore(1) },
  { id: "c2", title: "Reference list", last_activity_time: hoursBefore(20) },
  { id: "c3", title: "Archive a record", last_activity_time: new Date(2026, 9, 2, 9, 15).toISOString() },
];

const REFERENCE = {
  id: "c2",
  title: "Reference list",
  messages: [
    { role: "user", content: "What is in the reference list?" },
    { role: "assistant", content: "The reference list has 12 entries, 3 of them new." },
  ],
  runs: [],
  running: null,
};

const thread = (page: Page) => page.locator(VIEWPORT);

async function showConversations(page: Page): Promise<void> {
  if (isPhone()) await page.getByRole("button", { name: "Conversation list" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test("a new conversation shows one short heading and the suggestions", async ({ page }) => {
  await page.goto("/");
  const welcome = thread(page).locator('[data-slot="empty-state"]');
  const starters = thread(page).locator('[data-slot="empty-state-suggestions"]');
  await expect(welcome.getByRole("heading")).toHaveText(["How can I help?"]);
  await expect(starters.getByRole("button")).toHaveText(SUGGESTIONS.map((suggestion) => suggestion.label));
  await expect(starters.getByRole("listitem")).toHaveCount(0);
  await expect(welcome).not.toContainText(/Good (morning|afternoon|evening)|confirm/);
  const below = async (upper: Locator, lower: Locator) => {
    const [top, bottom] = [await upper.boundingBox(), await lower.boundingBox()];
    expect(bottom!.y).toBeGreaterThanOrEqual(top!.y + top!.height);
  };
  const composer = page.locator('[data-slot="aui_composer-shell"]');
  await below(welcome, composer);
  await below(composer, starters);
  const greeting = await welcome.getByRole("heading").boundingBox();
  expect(Math.abs(greeting!.x - (await composer.boundingBox())!.x)).toBeLessThan(16);
  await expect(page.getByText(/Nothing changes until you confirm it/)).toHaveCount(0);
  const send = await page.getByRole("button", { name: "Send message" }).boundingBox();
  const shell = await composer.boundingBox();
  expect(shell!.x + shell!.width - (send!.x + send!.width)).toBeLessThan(16);
  await checkScreen(page, "welcome");
});

test("a suggestion puts its question in the composer and waits for Send", async ({ page, api }) => {
  const { label, prompt: question } = SUGGESTIONS[0];
  api.reply("POST /api/sessions", { ...ok({ id: "c9", title: question }), status: 201 });
  api.reply(INVOKE, run(said(ANSWER)));
  await page.goto("/");
  await page.getByRole("button", { name: label }).click();

  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toHaveValue(question);
  await expect(page.locator(USER_MESSAGE)).toHaveCount(0);
  expect(api.posted(INVOKE)).toEqual([]);

  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(USER_MESSAGE).locator(QUESTION_TEXT)).toHaveText(question);
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  expect(api.posted(INVOKE)[0].input).toEqual(asked(question));
});

test("the first message puts the conversation in the address and the list", async ({ page, api }) => {
  const question = "What are my records?";
  api.reply("POST /api/sessions", { ...ok({ id: "c9", title: question }), status: 201 });
  api.reply("GET /api/sessions", ok([]), ok([{ id: "c9", title: question, last_activity_time: NOW.toISOString() }]));
  api.reply(INVOKE, run(said(ANSWER)));
  await page.goto("/");
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(question);
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page).toHaveURL(/#\/assistant\/c9$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(question);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Assistant" })).toHaveAttribute(
    "href",
    "#/assistant/c9",
  );
  await showConversations(page);
  const link = page.getByRole("navigation", { name: "Conversations" }).getByRole("link", { name: question });
  await expect(link).toHaveAttribute("aria-current", "page");
});

test("the conversation list says when it is loading and when it is empty", async ({ page }) => {
  const held: Route[] = [];
  await page.route("**/api/sessions", (route) => {
    if (route.request().method() === "GET") held.push(route);
    else return route.fallback();
  });
  await page.goto("/");
  await showConversations(page);
  const list = page.getByRole("navigation", { name: "Conversations" });
  await expect(list.getByRole("status")).toHaveText("Loading your conversations");

  await expect.poll(() => held.length).toBeGreaterThan(0);
  await held[0].fulfill(ok([]));
  await expect(list.getByText("No conversations yet")).toBeVisible();
  await expect(list.getByRole("status")).toHaveCount(0);
});

test("conversations are grouped by day, and a link opens one, also after a reload", async ({ page, api }) => {
  api.reply("GET /api/sessions", ok(SESSIONS));
  api.reply("GET /api/sessions/c2", ok(REFERENCE));
  await page.goto("/");
  await showConversations(page);
  const list = page.getByRole("navigation", { name: "Conversations" });
  await expect(list.getByRole("heading", { level: 3 })).toHaveText(["Today", "Yesterday", "Earlier"]);

  await list.getByRole("link", { name: "Reference list" }).click();
  await expect(page).toHaveURL(/#\/assistant\/c2$/);
  await expect(list.getByRole("link", { name: "Reference list" })).toHaveAttribute("aria-current", "page");
  const showsReference = async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reference list");
    await expect(page.locator("#chat-title + p")).toHaveText("Yesterday");
    await expect(page.locator(USER_MESSAGE)).toHaveText(["What is in the reference list?"]);
    await expect(page.locator(ANSWER_TEXT)).toHaveText(REFERENCE.messages[1].content);
    await expect(page.locator(STEPS)).toHaveCount(0);
  };
  await showsReference();
  await checkScreen(page, "conversation");

  await page.reload();
  await showsReference();
});

test("a long conversation title stays on one line and shows in full on hover", async ({ page, api }) => {
  const long = "List the actions you can help me with, and explain each one with an example";
  api.reply("GET /api/sessions", ok([{ ...SESSIONS[0], title: long }, ...SESSIONS.slice(1)]));
  await page.goto("/");
  await showConversations(page);
  const list = page.getByRole("navigation", { name: "Conversations" });
  const height = async (name: string | RegExp) => (await list.getByRole("link", { name }).boundingBox())?.height;

  await expect(list.getByRole("link", { name: long })).toHaveAttribute("title", long);
  expect(await height(long)).toBe(await height("Reference list"));
  expect(await height(/Archive a record/)).toBe(await height("Reference list"));
  await checkScreen(page, "long-title");
});

test("an unknown conversation says so and offers a new one", async ({ page }) => {
  await page.goto("/#/assistant/gone");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conversation not found");
  await expect(page.getByText("We can't find this conversation.")).toBeVisible();
  await checkScreen(page, "conversation-missing");

  await page.getByRole("link", { name: "Start a new conversation" }).click();
  await expect(page).toHaveURL(/#\/assistant$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New conversation");
  await expect(thread(page).getByRole("heading", { level: 2 })).toHaveText("How can I help?");
});

test("a conversation that fails to load offers Try again", async ({ page, api }) => {
  api.reply("GET /api/sessions", ok(SESSIONS));
  api.reply("GET /api/sessions/c2", failed(502), ok(REFERENCE));
  await page.goto("/#/assistant/c2");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("We can't show this conversation right now");

  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(USER_MESSAGE)).toHaveText(["What is in the reference list?"]);
});

for (const { from, button, question } of ASK_LINKS) {
  test(`${button} opens a new conversation with the question ready`, async ({ page, api }) => {
    api.reply("GET /api/sessions", ok(SESSIONS));
    api.reply("GET /api/sessions/c2", ok(REFERENCE));
    await page.goto("/#/assistant/c2");
    await expect(page.locator(USER_MESSAGE)).toHaveCount(1);
    await page.goto(from);
    await page.getByRole("link", { name: button }).click();

    await expect(page).toHaveURL(/#\/assistant$/);
    const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
    await expect(composer).toHaveValue(question);
    await expect(composer).toBeFocused();
    await expect(page.locator(USER_MESSAGE)).toHaveCount(0);
    expect(api.posted(INVOKE)).toEqual([]);
  });
}

test("the composer grows, Enter sends and Shift+Enter adds a line", async ({ page, api }) => {
  api.reply("POST /api/sessions", { ...ok({ id: "c9", title: "Line one" }), status: 201 });
  api.reply(INVOKE, run(said("Noted.")));
  await page.goto("/");
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeDisabled();
  const oneLine = (await composer.boundingBox())?.height ?? 0;

  await composer.fill("Line one");
  await expect(send).toBeEnabled();
  await composer.press("Shift+Enter");
  await composer.pressSequentially("Line two");
  await expect(composer).toHaveValue("Line one\nLine two");
  expect((await composer.boundingBox())?.height).toBeGreaterThan(oneLine);

  await composer.press("Enter");
  await expect(page.locator(ANSWER_TEXT)).toHaveText("Noted.");
  expect(api.posted(INVOKE)[0].input.messages[0].content).toBe("Line one\nLine two");
  await expect(composer).toHaveValue("");
  await expect(send).toBeDisabled();
});
