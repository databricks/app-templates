import { expect, type Page, test } from "@playwright/test";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import { ASSISTANT_MESSAGE, QUESTION_TEXT, STEP, STEPS, STEPS_TOGGLE, USER_MESSAGE } from "../ui/fixtures";

const BALANCES = "What are my balances?";
const DISPUTE = "I don't recognise the ELECTROSHOP ONLINE charge on my credit card. Please dispute it.";
const CURRENT_BALANCE = /3,?240\.15/;

function isInvocation(url: string): boolean {
  return new URL(url).pathname === "/api/invocations";
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

function lastAnswer(page: Page) {
  return page.locator(ASSISTANT_MESSAGE).last();
}

async function answered(page: Page): Promise<void> {
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
}

/** Open the last answer's first timeline and wait for a finished step. */
async function expectDoneStep(page: Page): Promise<void> {
  await lastAnswer(page).locator(STEPS).getByRole("button", STEPS_TOGGLE).first().click();
  await expect(lastAnswer(page).locator(`${STEP}[data-state="done"]`).first()).toBeVisible();
}

test("a live answer streams, shows its steps, and comes back after a reload and from the list", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && ["/api/sessions", "/api/invocations"].includes(path)) posts.push(path);
  });
  await page.goto("/");
  const stream = page.waitForResponse((response) => isInvocation(response.url()));

  await ask(page, BALANCES);
  await answered(page);
  await expect(lastAnswer(page)).toContainText(CURRENT_BALANCE);
  expect(posts.slice(0, 2)).toEqual(["/api/sessions", "/api/invocations"]);
  const events = await (await stream).text();
  expect(events.match(/^event: delta$/gm)?.length ?? 0).toBeGreaterThan(1);
  await expectDoneStep(page);

  await expect(page).toHaveURL(/#\/assistant\/[\w-]+$/);
  await page.reload();
  await expect(page.locator(USER_MESSAGE).locator(QUESTION_TEXT)).toHaveText([BALANCES]);
  await expect(page.locator(USER_MESSAGE).locator("time")).toHaveCount(1);
  await expect(lastAnswer(page)).toContainText(CURRENT_BALANCE);
  await expectDoneStep(page);

  const conversations = page.getByRole("navigation", { name: "Conversations" });
  await conversations.getByRole("button", { name: "New conversation" }).click();
  await expect(page.locator(USER_MESSAGE)).toHaveCount(0);
  await conversations.getByRole("link", { name: BALANCES }).first().click();
  await expect(page.locator(USER_MESSAGE).locator(QUESTION_TEXT)).toHaveText([BALANCES]);
  await expect(lastAnswer(page)).toContainText(CURRENT_BALANCE);
});

test("cancels a proposed dispute from its card, and a reload keeps it not changed", async ({ page }) => {
  await page.goto("/");
  await ask(page, DISPUTE);
  const card = page.getByTestId("confirm-card");
  await expect(card.getByRole("heading", { name: "Dispute a card payment" })).toBeVisible();
  await expect(card).toContainText("TX-1003-899");
  await answered(page);
  const answers = await page.locator(ASSISTANT_MESSAGE).count();
  const status = card.locator('[data-slot="approval-card-subtitle"]');
  const receipt = card.locator('[data-slot="approval-card-receipt"]');

  const decision = page.waitForResponse(
    (response) => isInvocation(response.url()) && (response.request().postData() ?? "").includes('"confirm"'),
  );
  await card.getByRole("button", { name: "Cancel" }).click();
  const response = await decision;
  expect(response.request().postDataJSON().input.confirm.decision).toBe("reject");
  await response.finished();

  await expect(status).toHaveText("Not changed");
  await expect(receipt).toHaveText("Nothing was changed.");
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(answers);

  await page.reload();
  await expect(status).toHaveText("Not changed");
  await expect(receipt).toHaveText("Nothing was changed.");
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(answers);
});

test("replays a dropped stream from the last event id", async ({ page }) => {
  let lastDelivered = 0;
  await page.route(
    "**/api/invocations",
    async (route) => {
      const response = await route.fetch();
      const events = (await response.text()).split("\n\n").filter(Boolean).slice(0, 3);
      lastDelivered = Number(/^id: (\d+)/m.exec(events[2])?.[1]);
      await route.fulfill({ response, body: `${events.join("\n\n")}\n\n` });
    },
    { times: 1 },
  );
  await page.goto("/");
  const replay = page.waitForRequest(/\/api\/invocations\/[^/]+\/events\?after=\d+/);

  await ask(page, BALANCES);

  const after = Number(new URL((await replay).url()).searchParams.get("after"));
  expect(after).toBeGreaterThan(0);
  expect(after).toBe(lastDelivered);
  await answered(page);
  await expect(lastAnswer(page)).toContainText(CURRENT_BALANCE);
});

test("the app loads without Content-Security-Policy violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) violations.push(message.text());
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  expect(violations).toEqual([]);
});
