import { expect, type Page, test } from "@playwright/test";
import { COMPOSER_PLACEHOLDER, SUGGESTIONS } from "../../../src/config/suggestions";
import { ASSISTANT_MESSAGE } from "../../ui/fixtures";

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'";

function isInvocation(url: string): boolean {
  return new URL(url).pathname === "/api/invocations";
}

async function answered(page: Page): Promise<void> {
  await expect(page.locator(ASSISTANT_MESSAGE).last()).toHaveAttribute("data-status", "complete");
}

test("a starter question streams one answer, and its rating reaches the run's trace", async ({ page }) => {
  await page.goto("/#/assistant");
  await page.getByRole("button", { name: SUGGESTIONS[0].label }).click();
  const stream = page.waitForResponse((response) => isInvocation(response.url()));
  await page.getByRole("button", { name: "Send message" }).click();

  expect((await stream).headers()["content-type"]).toContain("text/event-stream");
  await answered(page);
  const rated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/feedback");
  await page.locator(ASSISTANT_MESSAGE).last().getByRole("button", { name: "Helpful", exact: true }).click();
  expect((await rated).status()).toBe(204);
});

test("a question runs on Opus when the user picks it", async ({ page }) => {
  await page.goto("/#/assistant");
  await page.getByRole("combobox", { name: /^Model:/ }).click();
  await page.getByRole("option", { name: /^Claude Opus 5\.5/ }).click();
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(SUGGESTIONS[0].prompt);
  const stream = page.waitForResponse((response) => isInvocation(response.url()));
  await page.getByRole("button", { name: "Send message" }).click();

  expect((await stream).request().postDataJSON().input.model).toBe("opus_llm");
  await answered(page);
  await expect(page.locator(ASSISTANT_MESSAGE).last()).not.toContainText("couldn't complete your request");
});

test("the proxy enforces security headers on / and /api/me", async ({ request }) => {
  for (const path of ["/", "/api/me"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["content-security-policy"], path).toBe(CSP);
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("same-origin");
    expect(headers["strict-transport-security"], path).toContain("max-age=31536000");
  }
});

test("the proxy replaces forged identity headers with the signed-in user", async ({ request }) => {
  const signedIn = await (await request.get("/api/me")).json();

  const forged = await request.get("/api/me", {
    headers: { "X-Forwarded-Email": "hacker@example.com", "X-Forwarded-Access-Token": "forged-token" },
  });

  expect(forged.status()).toBe(200);
  expect((await forged.json()).email).toBe(signedIn.email);
});
