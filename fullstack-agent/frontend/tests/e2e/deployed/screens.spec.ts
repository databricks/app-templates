import { expect, type Page, test } from "@playwright/test";
import { COMPOSER_PLACEHOLDER } from "../../../src/config/suggestions";
import { ANSWER_TEXT, ASSISTANT_MESSAGE, NOTE_TEXT, STEP, STEPS, STEPS_TOGGLE, USER_MESSAGE, VIEWPORT } from "../../ui/fixtures";

const SHOTS = "test-results/screens";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const RATES = "What are my balances and the savings rates?";
const DISPUTE = "I don't recognise the ELECTROSHOP ONLINE charge on my credit card. Please dispute it.";
const SET_BALANCE = "Please set my balance to 1,000,000";

/** Patterns the model must not write for customers: Markdown, IDs, platform/table names, SQL, instructions. */
const NOT_FOR_CUSTOMERS = [/\*\*/, /^## /m, /ACC-|TX-/, /\bUnity\b|Databricks|\b[a-z]+_(?:data|reference|ops)\.|\bSQL\b|instructions/i];

/** Wait for CSS transitions triggered by a resize. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.allSettled(
      document.getAnimations().flatMap((animation) => (animation instanceof CSSTransition ? [animation.finished] : [])),
    ),
  );
}

/** Screenshot at desktop and phone widths; resizing keeps the page intact. */
async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/desktop/${name}.png` });
  await page.setViewportSize(PHONE);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/phone/${name}.png` });
  await page.setViewportSize(DESKTOP);
  await settle(page);
}

/** Send a question and wait for it to appear in the thread. */
async function ask(page: Page, text: string): Promise<void> {
  const questions = page.locator(USER_MESSAGE);
  const before = await questions.count();
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(questions).toHaveCount(before + 1);
}

function lastAnswer(page: Page) {
  return page.locator(ASSISTANT_MESSAGE).last();
}

async function answered(page: Page): Promise<void> {
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
}

/** Check all model text (answers, notes, steps) is customer-appropriate. */
async function expectCustomerWording(page: Page): Promise<void> {
  for (const toggle of await page.locator(STEPS).getByRole("button", STEPS_TOGGLE).all()) {
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  }
  const texts = await page.locator(`${ANSWER_TEXT}, ${NOTE_TEXT}, ${STEP}`).allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) {
    for (const pattern of NOT_FOR_CUSTOMERS) expect(text, `customer-facing text: ${text}`).not.toMatch(pattern);
  }
}

/** Open first timeline and return finished steps. */
async function doneSteps(page: Page) {
  await lastAnswer(page).locator(STEPS).getByRole("button", STEPS_TOGGLE).first().click();
  return lastAnswer(page).locator(`${STEP}[data-state="done"]`);
}

test("walks through the main states", async ({ page }) => {
  await page.goto("/#/accounts");
  await expect(page.getByRole("link", { name: /Holiday fund/ })).toContainText("€8,500.00");
  await shoot(page, "accounts");

  await page.goto("/#/rates");
  await expect(page.getByRole("row", { name: /Easy Saver/ })).toBeVisible();
  await shoot(page, "rates");

  await page.goto("/#/assistant");
  await expect(page.locator(VIEWPORT).getByRole("heading", { level: 2 })).toHaveText("How can I help?");
  await shoot(page, "empty");

  await ask(page, RATES);
  await answered(page);
  await expect((await doneSteps(page)).first()).toBeVisible();
  await shoot(page, "answer");

  await ask(page, DISPUTE);
  const card = page.getByTestId("confirm-card");
  await expect(card.getByRole("button", { name: "File dispute" })).toBeVisible();
  await expect(card).toContainText("TX-81003-899");
  await expect(card).toContainText("ELECTROSHOP ONLINE");
  await expect(card).toContainText("€899.00");
  await answered(page);
  await shoot(page, "confirm");

  const answers = await page.locator(ASSISTANT_MESSAGE).count();
  const decision = page.waitForResponse(
    (response) => response.url().endsWith("/api/invocations") && (response.request().postData() ?? "").includes('"confirm"'),
  );
  await card.getByRole("button", { name: "File dispute" }).click();
  await (await decision).finished();
  await expect(card.locator('[data-slot="approval-card-subtitle"]')).toHaveText("Completed");
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText(/^Dispute filed\. Your reference is DSP-\S+\.$/);
  await expect(page.locator(ASSISTANT_MESSAGE)).toHaveCount(answers);
  await shoot(page, "filed");

  await ask(page, SET_BALANCE);
  await answered(page);
  await expect(page.getByTestId("confirm-card")).toHaveCount(1);
  await shoot(page, "refused");
  await expectCustomerWording(page);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
  const activity = page.locator('[data-slot="activity-row"]');
  const badge = '[data-slot="badge"]';
  await expect(activity.filter({ hasText: "Dispute filed" }).locator(badge)).toHaveText("Completed");
  await expect(activity.filter({ hasText: "Viewed product rates" }).locator(badge)).toHaveText("Bank information");
  await expect(activity.locator(badge).filter({ hasText: "Your data" }).first()).toBeVisible();
  await shoot(page, "activity");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Assistant activity");
  await expect(activity.filter({ hasText: "Dispute filed" }).locator(badge)).toHaveText("Completed");
  await expect(activity.filter({ hasText: "Viewed product rates" }).locator(badge)).toHaveText("Bank information");
});
