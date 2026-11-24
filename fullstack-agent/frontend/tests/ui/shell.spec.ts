import { PRODUCT_NAME } from "../../src/config/brand";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import {
  ANSWER_TEXT,
  checkScreen,
  expect,
  failed,
  isPhone,
  ok,
  run,
  said,
  test,
  VIEWPORT,
} from "./fixtures";
import { ME, NAV_PAGES } from "./mock-data";

const PAGES = [
  ...NAV_PAGES,
  { link: "Activity", heading: "Assistant activity" },
  { link: "Assistant", heading: "New conversation" },
];

test("the main nav moves between pages and puts focus on each page heading", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(`Assistant | ${PRODUCT_NAME}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New conversation");
  await checkScreen(page, "assistant");

  const nav = page.getByRole("navigation", { name: "Main" });
  const box = await nav.boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  if (isPhone()) expect(box?.y).toBeGreaterThan(height - 100);
  else expect(box?.y).toBeLessThan(60);

  for (const { link, heading } of PAGES) {
    await nav.getByRole("link", { name: link }).click();
    await expect(page).toHaveTitle(`${link} | ${PRODUCT_NAME}`);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(heading);
    await expect(h1).toBeFocused();
    await expect(nav.getByRole("link", { name: link })).toHaveAttribute("aria-current", "page");
  }
});

test("on phones the tab bar steps aside while the user types, so the keyboard leaves room for the chat", async ({
  page,
  api,
}) => {
  test.skip(!isPhone(), "the tab bar exists only on phones");
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: "Hello" }), status: 201 });
  api.reply("POST /api/invocations", run(said("Hello, how can I help?")));
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  const composer = page.getByPlaceholder(COMPOSER_PLACEHOLDER);
  const before = await composer.boundingBox();

  await composer.focus();
  await expect(nav).toBeHidden();
  const typing = await composer.boundingBox();
  expect(typing?.y).toBeGreaterThan(before?.y ?? 0);

  await composer.blur();
  await expect(nav).toBeVisible();

  await composer.fill("Hello");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(`${ANSWER_TEXT}[data-status='complete']`)).toHaveText("Hello, how can I help?");
});

test("the tab shows the brand mark as its icon", async ({ page }) => {
  await page.goto("/");
  const icon = await page.locator('link[rel="icon"]').getAttribute("href");
  const response = await page.request.get(icon ?? "");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
});

test("an unknown route opens the assistant", async ({ page }) => {
  await page.goto("/#/nowhere");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New conversation");
});

test("a 401 from the session check shows the signed-out screen, and Sign in again reloads", async ({ page, api }) => {
  api.reply("GET /api/me", failed(401, "MCP_USER_AUTH_REQUIRED"), ok(ME));
  await page.goto(NAV_PAGES[0].route);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You've been signed out");
  await expect(page.getByText("quote error code USER-AUTH-REQUIRED")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(page).toHaveTitle(`Signed out | ${PRODUCT_NAME}`);
  await checkScreen(page, "signed-out");

  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAV_PAGES[0].heading);
});

test("a 401 from a later call signs the app out", async ({ page, api }) => {
  api.reply("POST /api/sessions", failed(401, "MCP_USER_IDENTITY_MISSING"));
  await page.goto("/");
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill("What are my records?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You've been signed out");
  await expect(page.getByText("quote error code USER-IDENTITY-MISSING")).toBeVisible();
});

test("a failed session check shows a plain message, and Try again loads the profile", async ({ page, api }) => {
  api.reply("GET /api/me", failed(502), ok(ME));
  await page.goto("/");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("We can't load your profile right now");
  await expect(page.getByRole("button", { name: /Account menu/ })).toHaveCount(0);
  await checkScreen(page, "profile-error");

  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Account menu/ })).toBeVisible();
});

test("the user menu shows who is signed in and closes on Escape", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: /Account menu/ });
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("dialog", { name: "Account" });
  await expect(menu).toContainText(ME.display_name);
  await expect(menu).toContainText(ME.email);
  await checkScreen(page, "user-menu");

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
});

test("the conversation list is a sidebar its toggle hides, or a drawer on phones", async ({ page, api }) => {
  api.reply("GET /api/sessions", ok([{ id: "c1", title: "What are my records?", last_activity_time: null }]));
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Conversation list" });
  const list = page.getByRole("navigation", { name: "Conversations" });

  if (!isPhone()) {
    await expect(list).toBeVisible();
    await expect(list.getByRole("link", { name: "What are my records?" })).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(list).not.toBeInViewport();
    await toggle.click();
    await expect(list).toBeInViewport();
    return;
  }
  await expect(list).toBeHidden();
  await toggle.click();
  await expect(list).toBeVisible();
  await expect(page.locator('[data-slot="sidebar-trigger"]')).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByRole("link", { name: "What are my records?" })).toBeVisible();
  await checkScreen(page, "conversations-drawer");

  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.locator('[data-slot="sheet-overlay"]').click({ position: { x: 370, y: 400 } });
  await expect(list).toBeHidden();
});

for (const viewport of [
  { width: 667, height: 375 },
  { width: 844, height: 390 },
]) {
  test.describe(`a phone turned sideways at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("keeps room for messages: the nav sits in the top bar and the conversations open as a drawer", async ({
      page,
      api,
    }) => {
      test.skip(!isPhone(), "a phone in landscape");
      api.reply("GET /api/sessions", ok([{ id: "c1", title: "What are my records?", last_activity_time: null }]));
      await page.goto("/");

      const nav = page.getByRole("navigation", { name: "Main" });
      expect((await nav.boundingBox())?.y).toBeLessThan(10);
      const messages = await page.locator(VIEWPORT).boundingBox();
      expect(messages?.height).toBeGreaterThanOrEqual(180);
      await checkScreen(page, `landscape-${viewport.width}x${viewport.height}`);

      const list = page.getByRole("navigation", { name: "Conversations" });
      await expect(list).toBeHidden();
      await page.getByRole("button", { name: "Conversation list" }).click();
      await expect(list.getByRole("link", { name: "What are my records?" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(list).toBeHidden();
    });
  });
}
