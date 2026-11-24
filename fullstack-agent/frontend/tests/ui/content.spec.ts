import type { Page } from "@playwright/test";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import { ANSWER_TEXT, ASSISTANT_MESSAGE, called, checkScreen, expect, ok, run, said, test } from "./fixtures";

const INVOKE = "POST /api/invocations";
const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");
const QUESTION = "Explain my records";
const FENCE = "```";
const LAZY_CHUNKS = /\/assets\/(tex|syntax-highlighter|mermaid-diagram)[^/]*\.js$/;

const MATH = [
  "Interest over a year is $I = P \\times r$, here $I = 1000 \\times 0.021$.",
  "",
  "$$A = P \\left(1 + \\frac{r}{n}\\right)^{nt} = 1000 \\times \\left(1 + \\frac{0.021}{12}\\right)^{12 \\times 5} = 1000 \\times 1.1105 = 1110.50$$",
  "",
  "A price of $5 stays text.",
].join("\n");

const INJECTED = "Try $\\href{https://example.com/x}{click}$ and $\\includegraphics{https://example.com/pixel.png}$ here.";

const CODE = [`${FENCE}python`, "def total(records):", "    return sum(record.amount for record in records)", FENCE].join("\n");

const MERMAID = [
  `${FENCE}mermaid`,
  "graph TD",
  "  A[Open] --> B[Archived]",
  "  style A fill:url(https://example.com/fill.svg#p)",
  FENCE,
].join("\n");

const HTML_LABEL = "<img src=x onerror=alert(";

const MERMAID_HTML = [`${FENCE}mermaid`, "graph TD", `  A["${HTML_LABEL}1)>"] -->|"${HTML_LABEL}2)>"| B[Archived]`, FENCE].join("\n");

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function answer(page: Page, api: { reply: (route: string, ...replies: ReturnType<typeof run>[]) => void }, text: string) {
  api.reply(INVOKE, run(MODEL, said(text)));
  await page.goto("/");
  await ask(page, QUESTION);
  await expect(page.locator(ASSISTANT_MESSAGE).last()).toHaveAttribute("data-status", "complete");
}

test.beforeEach(async ({ api }) => {
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: QUESTION }), status: 201 });
});

test("the first load carries no math, code or diagram renderer", async ({ page }) => {
  const loaded: string[] = [];
  page.on("request", (request) => loaded.push(request.url()));
  await page.goto("/");
  await expect(page.getByPlaceholder(COMPOSER_PLACEHOLDER)).toBeVisible();
  expect(loaded.filter((url) => LAZY_CHUNKS.test(new URL(url).pathname))).toEqual([]);
});

test("LaTeX renders inline and on its own line, wrapping inside the answer, and a $ before a number stays text", async ({
  page,
  api,
}) => {
  await answer(page, api, MATH);
  const text = page.locator(ANSWER_TEXT);
  await expect(text.locator(".katex")).toHaveCount(3);
  await expect(text.locator(".katex-display")).toHaveCount(1);
  await expect(text).toContainText("A price of $5 stays text.");
  const edge = (await text.boundingBox())!;
  const bases = await text.locator(".katex .base").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right));
  expect(Math.max(...bases)).toBeLessThanOrEqual(edge.x + edge.width + 1);
  await checkScreen(page, "content-math");
});

test("LaTeX that tries to link or load an image shows its command as text, with no link, image or request", async ({ page, api }) => {
  const outside: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.com")) outside.push(request.url());
  });
  await answer(page, api, INJECTED);
  const text = page.locator(ANSWER_TEXT);
  await expect(text.locator(".katex")).toHaveCount(2);
  await expect(text).toContainText("\\href");
  await expect(text).toContainText("\\includegraphics");
  await expect(text.locator("a, img")).toHaveCount(0);
  expect(outside).toEqual([]);
});

test("a code block is highlighted and wraps its long lines", async ({ page, api }) => {
  await answer(page, api, CODE);
  const code = page.locator(`${ANSWER_TEXT} pre code`);
  await expect(code).toContainText("def total(records):");
  const keyword = code.locator(".token").first();
  await expect(keyword).toHaveText("def");
  await expect(keyword).toHaveAttribute("style", /color/);
  await checkScreen(page, "content-code");
});

test("a Mermaid block draws its diagram without its style lines, so it loads nothing", async ({ page, api }) => {
  const outside: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.com")) outside.push(request.url());
  });
  await answer(page, api, MERMAID);
  const diagram = page.locator(`${ANSWER_TEXT} svg`).first();
  await expect(diagram).toBeVisible();
  await expect(page.locator(ANSWER_TEXT)).toContainText("Archived");
  expect(outside).toEqual([]);
  await checkScreen(page, "content-mermaid");
});

test("HTML in a Mermaid label shows as text, with no element or script", async ({ page, api }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await answer(page, api, MERMAID_HTML);
  const diagram = page.locator(`${ANSWER_TEXT} [data-aui-mermaid-svg] svg`);
  await expect(diagram).toBeVisible();
  await expect(diagram).toContainText(`${HTML_LABEL}1`);
  await expect(diagram).toContainText(`${HTML_LABEL}2`);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
