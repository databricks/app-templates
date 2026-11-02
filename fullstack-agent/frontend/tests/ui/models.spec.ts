import type { Locator, Page, Request, Route } from "@playwright/test";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import {
  type Api,
  ANSWER_TEXT,
  ASSISTANT_MESSAGE,
  asked,
  called,
  checkScreen,
  expect,
  MODELS,
  NOTE_TEXT,
  ok,
  replayed,
  run,
  said,
  sse,
  STEP,
  STEPS,
  STEPS_TOGGLE,
  storedRuns,
  test,
  USER_MESSAGE,
  whole,
} from "./fixtures";

const QUESTION = "What are my records?";
const ANSWER = "You have 3 records.";
const INVOKE = "POST /api/invocations";
const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'";
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const PIXEL_URL = `data:image/png;base64,${PIXEL.toString("base64")}`;
const THOUGHT = "The records list needs one read.\n\nThen a table shows them best.";
const NOTE = "I'll look at your records to count them.";
const READ_STEP = "Looking at your records";
const SHOW_STEP = "Showing your records";
const LAST_THOUGHT = "The table holds the rows, so one sentence answers.";
const TABLE_ANSWER = "Your records are in the table above.";
const THOUGHT_TEXT = '[data-slot="thought"]';
const TABLE = '[data-slot="data-table"]';
const USAGE = { type: "usage", requests: 1, input_tokens: 9, output_tokens: 3, context_tokens: 12 };
const LETTER = "What does this letter say?";
const LETTER_INPUT = {
  messages: [
    {
      role: "user",
      content: [
        { type: "input_text", text: LETTER },
        { type: "input_image", image_url: PIXEL_URL },
      ],
    },
  ],
  model: "opus_llm",
  effort: "low",
};

/** High-effort run: think, read, show table, think again, answer. */
const THINKING_ORDER = [
  { type: "run.started" },
  { type: "received", at: new Date(2026, 9, 10, 14, 0).toISOString() },
  MODEL,
  { type: "reasoning", id: 1, text: THOUGHT.slice(0, 20) },
  { type: "reasoning", id: 1, text: THOUGHT },
  { type: "delta", content: NOTE.slice(0, 20) },
  { type: "narration", id: 1, text: NOTE },
  { type: "status", step: "call_1", tool: "read_records", text: READ_STEP, at: new Date(2026, 9, 10, 14, 0, 1).toISOString() },
  called("read_records", "user", "test_data.records", "allowed", { call_id: "call_1" }),
  { type: "step.done", step: "call_1", at: new Date(2026, 9, 10, 14, 0, 2).toISOString() },
  { type: "status", step: "call_2", tool: "show_table", text: SHOW_STEP, at: new Date(2026, 9, 10, 14, 0, 3).toISOString() },
  {
    type: "display",
    call_id: "call_2",
    view: "table",
    payload: { title: "Your records", columns: [{ key: "name", label: "Record" }], rows: [{ name: "Archive" }, { name: "Drafts" }] },
  },
  { type: "step.done", step: "call_2", at: new Date(2026, 9, 10, 14, 0, 4).toISOString() },
  { type: "reasoning", id: 3, text: LAST_THOUGHT.slice(0, 25) },
  { type: "reasoning", id: 3, text: LAST_THOUGHT },
  ...[0, 18].map((start) => ({ type: "delta", content: TABLE_ANSWER.slice(start, start + 18) })),
  { type: "work.done", seconds: 4 },
  { type: "message", message: { role: "assistant", content: TABLE_ANSWER } },
  { type: "usage", requests: 3, input_tokens: 9000, output_tokens: 300, context_tokens: 4000 },
  { type: "run.completed" },
];

test.beforeEach(async ({ page, api }) => {
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: QUESTION }), status: 201 });
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": CSP } });
    },
  );
});

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function chooseModel(page: Page, model: RegExp, effort?: string): Promise<void> {
  await page.getByRole("combobox", { name: /^Model:/ }).click();
  if (effort) await page.getByRole("radio", { name: effort }).click();
  await page.getByRole("option", { name: model }).click();
}

/** Reply to conversation route with a question on Opus, image, and answer. */
function reopenLetter(api: Api): void {
  api.reply(
    "GET /api/sessions/c1",
    ok({
      id: "c1",
      title: LETTER,
      messages: [],
      runs: storedRuns({ id: "r1", input: LETTER_INPUT, events: whole(MODEL, said(ANSWER)) }),
      running: null,
    }),
  );
}

/** True if request refreshes conversations list (send does this after run ends). */
const isListRefresh = (request: Request) => request.method() === "GET" && new URL(request.url()).pathname === "/api/sessions";

async function attachPixel(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Attachment" }).click();
  await (await chooser).setFiles({ name: "letter.png", mimeType: "image/png", buffer: PIXEL });
}

/** Offset of locator from top of its message; ignores scrolling. */
async function offset(page: Page, locator: Locator): Promise<number> {
  const [box, message] = [await locator.boundingBox(), await page.locator(ASSISTANT_MESSAGE).boundingBox()];
  return box!.y - message!.y;
}

test("the composer offers each model with its mark and effort, and a question runs on the chosen ones", async ({
  page,
  api,
}) => {
  api.reply(INVOKE, run(MODEL, said(ANSWER)));
  await page.goto("/");

  const trigger = page.getByRole("combobox", { name: /^Model:/ });
  await expect(trigger).toHaveAccessibleName("Model: Claude Sonnet 5.5, Low");
  await trigger.click();
  const options = page.getByRole("option");
  await expect(options).toHaveText([/^Claude Sonnet 5\.5$/, /^Claude Opus 5\.5Reads images$/]);
  await expect(page.getByRole("radiogroup", { name: "Thinking" }).getByRole("radio")).toHaveText(["Low", "Medium", "High"]);
  await checkScreen(page, "model-menu");
  await page.getByRole("radio", { name: "High" }).click();
  await page.getByRole("option", { name: /^Claude Opus 5\.5/ }).click();
  await expect(trigger).toHaveAccessibleName("Model: Claude Opus 5.5, High");

  await ask(page, QUESTION);
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  expect(api.posted(INVOKE)[0].input).toEqual({ ...asked(QUESTION), model: "opus_llm", effort: "high" });
});

test("the attach button shows only for a model that reads images, and the image goes with the question", async ({
  page,
  api,
}) => {
  api.reply(INVOKE, run(MODEL, said(ANSWER)));
  await page.goto("/");
  const attach = page.getByRole("button", { name: "Add Attachment" });
  await expect(page.getByRole("combobox", { name: /^Model:/ })).toBeVisible();
  await expect(attach).toHaveCount(0);

  await chooseModel(page, /^Claude Opus 5\.5/);
  await attachPixel(page);
  const tile = page.getByRole("button", { name: "Preview letter.png" });
  await expect(tile.locator("img")).toBeVisible();
  await checkScreen(page, "attachment-in-composer");

  await ask(page, "What does this letter say?");
  const question = page.locator(USER_MESSAGE);
  await expect(question.getByRole("button", { name: "Preview Image 1" }).locator("img")).toBeVisible();
  await expect(page.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  expect(api.posted(INVOKE)[0].input).toEqual({
    messages: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "What does this letter say?" },
          { type: "input_image", image_url: PIXEL_URL },
        ],
      },
    ],
    model: "opus_llm",
    effort: "low",
  });
  await checkScreen(page, "attachment-sent");
});

test("choosing a model that reads no images takes the attached images out of the composer", async ({ page }) => {
  await page.goto("/");
  await chooseModel(page, /^Claude Opus 5\.5/);
  await attachPixel(page);
  await expect(page.getByRole("button", { name: "Preview letter.png" })).toBeVisible();

  await chooseModel(page, /^Claude Sonnet 5\.5/);
  await expect(page.getByRole("button", { name: "Preview letter.png" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Attachment" })).toHaveCount(0);
});

test("an image over 1.4 MB stays in the composer, marked failed", async ({ page }) => {
  await page.goto("/");
  await chooseModel(page, /^Claude Opus 5\.5/);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Attachment" }).click();
  await (await chooser).setFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(1_400_001) });

  await expect(page.getByRole("button", { name: "Preview large.png, upload failed" })).toBeVisible();
});

test("the picker offers only the image types the backend takes", async ({ page }) => {
  await page.goto("/");
  await chooseModel(page, /^Claude Opus 5\.5/);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Attachment" }).click();

  expect(await (await chooser).element().getAttribute("accept")).toBe("image/png,image/jpeg,image/gif,image/webp");
});

test("a file that is not an image stays out of the composer, and a notice says which types it takes", async ({ page }) => {
  await page.goto("/");
  await chooseModel(page, /^Claude Opus 5\.5/);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Attachment" }).click();
  await (await chooser).setFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });

  const notice = page.getByRole("status").filter({ hasText: "Attach a PNG, JPEG, GIF or WebP image." });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview notes.pdf" })).toHaveCount(0);
  await checkScreen(page, "attachment-refused");

  await attachPixel(page);
  await expect(page.getByRole("button", { name: "Preview letter.png" })).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test("an answer offers another model, which reruns it", async ({ page, api }) => {
  api.reply(
    "GET /api/sessions/c1",
    ok({
      id: "c1",
      title: QUESTION,
      messages: [],
      runs: storedRuns({ id: "r1", input: asked(QUESTION), events: whole(MODEL, said(ANSWER)) }),
      running: null,
    }),
  );
  api.reply(INVOKE, run(MODEL, said("It says hello.")));
  await page.goto("/#/assistant/c1");

  const reply = page.locator(ASSISTANT_MESSAGE);
  await reply.getByRole("button", { name: "Ask another model" }).click();
  const menu = page.locator('[data-slot="regenerate-menu"]');
  await expect(menu.getByRole("button")).toHaveText(["Claude Sonnet 5.5current", "Claude Opus 5.5"]);
  await checkScreen(page, "regenerate-menu");

  await menu.getByRole("button", { name: /Claude Opus 5\.5/ }).click();
  await expect(reply.locator(ANSWER_TEXT)).toHaveText("It says hello.");
  expect(api.posted(INVOKE)[0].input).toEqual({ ...asked(QUESTION), replace: true, model: "opus_llm" });
});

test("a reopened question shows its images, and its answer offers no model that can't read them", async ({ page, api }) => {
  reopenLetter(api);
  await page.goto("/#/assistant/c1");

  await expect(page.locator(USER_MESSAGE).getByRole("button", { name: "Preview Image 1" }).locator("img")).toBeVisible();
  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply.getByRole("button", { name: "Regenerate", exact: true })).toBeVisible();
  await expect(reply.getByRole("button", { name: "Ask another model" })).toHaveCount(0);
});

test("an edit of a question with images runs on the turn's own model, since the chosen one may not read them", async ({ page, api }) => {
  const edited = "What does the letter say at the end?";
  reopenLetter(api);
  api.reply(INVOKE, run({ type: "replaced" }, MODEL, said("It says goodbye.")));
  await page.goto("/#/assistant/c1");
  await expect(page.getByRole("combobox", { name: /^Model:/ })).toHaveAccessibleName("Model: Claude Sonnet 5.5, Low");

  await page.locator(USER_MESSAGE).getByRole("button", { name: "Edit" }).click();
  await page.locator(".aui-edit-composer-input").fill(edited);
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.locator(ANSWER_TEXT)).toHaveText("It says goodbye.");
  const [question] = LETTER_INPUT.messages;
  expect(api.posted(INVOKE)[0].input).toEqual({
    ...LETTER_INPUT,
    messages: [{ ...question, content: [{ type: "input_text", text: edited }, question.content[1]] }],
    replace: true,
  });
});

test("the composer takes at most three images, one per pick", async ({ page }) => {
  await page.goto("/");
  await chooseModel(page, /^Claude Opus 5\.5/);
  const attach = page.getByRole("button", { name: "Add Attachment" });
  for (const name of ["one.png", "two.png", "three.png"]) {
    const chooser = page.waitForEvent("filechooser");
    await attach.click();
    const picker = await chooser;
    expect(picker.isMultiple()).toBe(false);
    await picker.setFiles({ name, mimeType: "image/png", buffer: PIXEL });
    await expect(page.getByRole("button", { name: `Preview ${name}` })).toBeVisible();
  }
  await expect(attach).toHaveCount(0);
});

test("the context ring shows how full the last run left the chosen model's window", async ({ page, api }) => {
  api.reply("GET /api/models", ok([MODELS[0], { ...MODELS[1], context_window: 400_000 }]));
  api.reply(INVOKE, run(MODEL, said(ANSWER), { type: "usage", requests: 1, input_tokens: 240_000, output_tokens: 10_000, context_tokens: 250_000 }));
  await page.goto("/");
  await ask(page, QUESTION);

  const ring = page.getByRole("button", { name: /^Context \d+% full$/ });
  await expect(ring).toHaveAccessibleName("Context 25% full");
  await checkScreen(page, "context-ring");
  await chooseModel(page, /^Claude Opus 5\.5/);
  await expect(ring).toHaveAccessibleName("Context 63% full");
});

test("an answer is finished at its usage, before the run writes Activity and ends", async ({ page, api }) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, ...said(ANSWER), USAGE]));
  let replay: Route | undefined;
  await page.route("**/api/invocations/*/events*", (route) => {
    replay = route;
  });
  await page.goto("/");
  await ask(page, QUESTION);

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply).toHaveAttribute("data-status", "complete");
  await expect(reply.getByRole("button", { name: "Copy" })).toBeVisible();
  await expect(reply.getByRole("button", { name: "Regenerate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);

  await expect.poll(() => replay).toBeDefined();
  await replayed(replay!, [{ type: "run.completed" }]);
  await expect(reply).toHaveAttribute("data-status", "complete");
});

test("a run that fails after its usage leaves the answer finished, without Try again", async ({ page, api }) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, ...said(ANSWER), USAGE]));
  await page.route("**/api/invocations/*/events*", (route) => replayed(route, [{ type: "run.failed" }]));
  await page.goto("/");
  const ended = page.waitForRequest(isListRefresh);
  await ask(page, QUESTION);
  await ended;

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply).toHaveAttribute("data-status", "complete");
  await expect(reply.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("a connection lost after the usage leaves the answer finished, without Try again", async ({ page, api }) => {
  api.reply(INVOKE, sse([{ type: "run.started" }, MODEL, ...said(ANSWER), USAGE]));
  let replays = 0;
  await page.route("**/api/invocations/*/events*", (route) => {
    replays += 1;
    return route.abort("connectionreset");
  });
  await page.goto("/");
  const ended = page.waitForRequest((request) => replays === 3 && isListRefresh(request), { timeout: 10_000 });
  await ask(page, QUESTION);
  await ended;

  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("a thinking run keeps its thoughts in arrival order, and a thought after a display goes below it without moving it", async ({
  page,
  api,
}) => {
  const pieces = [
    THINKING_ORDER.slice(0, 4),
    THINKING_ORDER.slice(4, 13),
    THINKING_ORDER.slice(13, 17),
    THINKING_ORDER.slice(17),
  ];
  const held: Route[] = [];
  await page.route("**/api/invocations/*/events*", (route) => {
    held.push(route);
  });
  api.reply(INVOKE, sse(pieces[0]));
  await page.goto("/");
  await ask(page, QUESTION);
  const reply = page.locator(ASSISTANT_MESSAGE);
  const groups = reply.locator(STEPS);
  const table = reply.locator(TABLE);
  let tableTop = 0;

  for (let index = 0; index < pieces.length; index++) {
    if (index > 0) {
      await expect.poll(() => held.length).toBe(index);
      await replayed(held[index - 1], pieces[index]);
    }
    if (index === 0) {
      await expect(groups).toHaveCount(1);
      await expect(reply.locator(THOUGHT_TEXT)).toHaveText(THOUGHT.slice(0, 20));
      await expect(groups.getByRole("button", { name: "Thinking" })).toBeVisible();
      await checkScreen(page, "thinking-1-first-thought");
    } else if (index === 1) {
      await expect(reply.locator(`${THOUGHT_TEXT}, ${NOTE_TEXT}, ${STEP}`)).toHaveText([
        THOUGHT,
        NOTE,
        `${READ_STEP}, Done`,
        `${SHOW_STEP}, Done`,
      ]);
      await expect(table).toContainText("Drafts");
      tableTop = await offset(page, table);
      await checkScreen(page, "thinking-2-display");
    } else if (index === 2) {
      await expect(groups).toHaveCount(2);
      await expect(groups.nth(1).locator(THOUGHT_TEXT)).toHaveText(LAST_THOUGHT);
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(TABLE_ANSWER);
      expect(await offset(page, table)).toBe(tableTop);
      const thoughtTop = await offset(page, groups.nth(1));
      expect(thoughtTop).toBeGreaterThan(tableTop + ((await table.boundingBox())?.height ?? 0) - 1);
      expect(await offset(page, reply.locator(ANSWER_TEXT))).toBeGreaterThan(thoughtTop);
      await checkScreen(page, "thinking-3-answer-below-the-thought");
    } else {
      await expect(reply).toHaveAttribute("data-status", "complete");
      await expect(reply.locator(ANSWER_TEXT)).toHaveText(TABLE_ANSWER);
      await expect(groups.nth(0).getByRole("button", STEPS_TOGGLE)).toHaveAccessibleName("Used 2 tools · 3s");
      await expect(groups.nth(1).getByRole("button", STEPS_TOGGLE)).toHaveAccessibleName("Thoughts");
      const tops = [
        await offset(page, groups.nth(0)),
        await offset(page, table),
        await offset(page, groups.nth(1)),
        await offset(page, reply.locator(ANSWER_TEXT)),
      ];
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      await checkScreen(page, "thinking-4-done");
    }
  }
});

test("dictation writes into the composer, and an answer is read aloud without its source markers", async ({ page, api }) => {
  await page.addInitScript(() => {
    class FakeRecognition extends EventTarget {
      start() {
        setTimeout(() => {
          this.dispatchEvent(new Event("start"));
          const result = Object.assign([{ transcript: "What are my records?" }], { isFinal: true });
          this.dispatchEvent(Object.assign(new Event("result"), { results: [result] }));
        });
      }
      stop() {
        setTimeout(() => this.dispatchEvent(new Event("end")));
      }
      abort() {
        this.stop();
      }
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition });
    const speak = (utterance: SpeechSynthesisUtterance) => Object.assign(window, { spoken: utterance.text });
    Object.defineProperty(window, "speechSynthesis", { value: { speak, cancel: () => undefined } });
  });
  api.reply(INVOKE, run(MODEL, said(`${ANSWER}(source:records)`)));
  await page.goto("/");

  await page.getByRole("button", { name: "Start voice input" }).click();
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toHaveValue(QUESTION);
  await page.getByRole("button", { name: "Stop voice input" }).click();
  await expect(page.getByRole("button", { name: "Start voice input" })).toBeVisible();

  await page.getByRole("button", { name: "Send message" }).click();
  const reply = page.locator(ASSISTANT_MESSAGE);
  await expect(reply.locator(ANSWER_TEXT)).toHaveText(ANSWER);
  await reply.getByRole("button", { name: "Read aloud" }).click();
  expect(await page.evaluate(() => (window as { spoken?: string }).spoken)).toBe(ANSWER);
  await reply.getByRole("button", { name: "Stop reading" }).click();
  await expect(reply.getByRole("button", { name: "Read aloud" })).toBeVisible();
});
