import { checkScreen, expect, failed, isPhone, ok, tabTo, test, WEBKIT_TABS_TO_FORM_CONTROLS_ONLY } from "./fixtures";
import { ACCOUNTS, PRODUCTS } from "./mock-data";

test("Accounts lists every account and shows the one you pick", async ({ page }) => {
  await page.goto("/#/accounts");
  const list = page.getByRole("navigation", { name: "Your accounts" });
  const links = list.getByRole("link");
  await expect(links).toHaveCount(4);
  await expect(links.nth(0)).toContainText("Current account");
  await expect(links.nth(0)).toContainText("Ending 0101");
  await expect(links.nth(0)).toContainText("€3,240.15");
  await expect(links.nth(0)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Current account" })).toContainText("NL01 RIVB 0000 1001 01");
  await checkScreen(page, "accounts");

  await links.nth(2).click();
  await expect(page).toHaveURL(/#\/accounts\/ACC-1003$/);
  await expect(links.nth(2)).toHaveAttribute("aria-current", "page");
  await expect(links.nth(2)).toContainText("Amount owed");
  const card = page.getByRole("region", { name: "Credit card" });
  await expect(card).toContainText("Credit card, ending 0103");
  await expect(card.locator('[data-slot="figure"]').nth(0)).toHaveText(/Amount owed\s*€612\.40/);
  await expect(card.locator('[data-slot="figure"]').nth(1)).toHaveText(/Credit limit\s*€3,000\.00/);
  await expect(card.locator('[data-slot="figure"]').nth(2)).toHaveText(/Available credit\s*€2,387\.60/);
  await checkScreen(page, "accounts-credit-card");

  await links.nth(3).click();
  await expect(page).toHaveURL(/#\/accounts\/ACC-1098$/);
  await expect(links.nth(3)).toHaveAttribute("aria-current", "page");
  const joint = page.getByRole("region", { name: "Joint account" });
  await expect(joint).toContainText("Joint account");
  await expect(joint.locator('[data-slot="figure"]').nth(0)).toHaveText(/Balance\s*Unavailable/);
});


test("Accounts says so when there are none", async ({ page, api }) => {
  api.reply("GET /api/me/accounts", ok([]));
  await page.goto("/#/accounts");
  await expect(page.getByText("You don't have any accounts with us yet.")).toBeVisible();
});

for (const { name, route, path, data, title, loaded } of [
  {
    name: "accounts",
    route: "/#/accounts",
    path: "GET /api/me/accounts",
    data: ACCOUNTS,
    title: "We can't show your accounts right now",
    loaded: "Holiday fund",
  },
  {
    name: "rates",
    route: "/#/rates",
    path: "GET /api/products",
    data: PRODUCTS,
    title: "We can't show our rates right now",
    loaded: "Easy Saver",
  },
]) {
  test(`${name} show a plain message when the service fails, and Try again loads them`, async ({ page, api }) => {
    api.reply(path, failed(502, "QUERY_FAILED"), ok(data));
    await page.goto(route);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(title);
    await expect(alert).not.toContainText("QUERY_FAILED");
    await checkScreen(page, `${name}-error`);

    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(loaded).first()).toBeVisible();
    await expect(alert).toHaveCount(0);
  });
}

test("Rates has a tab per product type and a table that stacks on phones", async ({ page }) => {
  await page.goto("/#/rates");
  const tabs = page.getByRole("navigation", { name: "Product type" }).getByRole("link");
  await expect(tabs).toHaveText(["Savings", "Current accounts", "Borrowing"]);
  await expect(tabs.nth(0)).toHaveAttribute("aria-current", "page");
  const rows = page.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Easy Saver");
  await expect(rows.nth(0)).toContainText("2.10%");
  await expect(rows.nth(0)).toContainText("Variable rate. Withdraw any time.");
  if (isPhone()) await expect(page.getByRole("table").locator("thead")).toBeHidden();
  else await expect(page.getByRole("table").locator("thead")).toBeVisible();
  await checkScreen(page, "rates");

  await tabs.nth(2).click();
  await expect(page).toHaveURL(/#\/rates\/borrowing$/);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Classic Card");
  await expect(rows.nth(0)).toContainText("19.90%APR");
  await checkScreen(page, "rates-borrowing");

  await tabs.nth(1).click();
  await expect(rows.nth(0)).toContainText("Everyday Current");
  await expect(rows.nth(0).getByRole("cell").first()).toHaveText("None");
});

test("the pages work with the keyboard alone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone-webkit", WEBKIT_TABS_TO_FORM_CONTROLS_ONLY);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });

  await tabTo(page, nav.getByRole("link", { name: "Rates" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  const borrowing = page.getByRole("navigation", { name: "Product type" }).getByRole("link", { name: "Borrowing" });
  await tabTo(page, borrowing);
  await page.keyboard.press("Enter");
  await expect(borrowing).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveText([/Classic Card/]);

  await tabTo(page, nav.getByRole("link", { name: "Accounts" }), "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  const holiday = page.getByRole("navigation", { name: "Your accounts" }).getByRole("link", { name: /Holiday fund/ });
  await tabTo(page, holiday);
  await page.keyboard.press("Enter");
  await expect(holiday).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Holiday fund" })).toContainText("Savings account, ending 0102");
});

test("80-character account and product names wrap without horizontal overflow", async ({ page, api }) => {
  const long = (seed: string) => seed.repeat(80).slice(0, 80);
  api.reply(
    "GET /api/me/accounts",
    ok(ACCOUNTS.map((account) => ({ ...account, nickname: long(account.nickname.replaceAll(" ", "")) }))),
  );
  api.reply(
    "GET /api/products",
    ok(
      PRODUCTS.map((product) => ({
        ...product,
        name: long(product.name.replaceAll(" ", "")),
        terms: long("Withdrawanytime"),
      })),
    ),
  );
  await page.goto("/");
  for (const [link, name] of [
    ["Accounts", "long-accounts"],
    ["Rates", "long-rates"],
  ]) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await checkScreen(page, name);
  }
});

test("a savings account passes the screen checks", async ({ page }) => {
  await page.goto("/#/accounts/ACC-1002");
  await expect(page.getByRole("region", { name: "Holiday fund" })).toContainText("Savings account, ending 0102");
  await checkScreen(page, "accounts-savings");
});

test("the Current rates tab passes the screen checks", async ({ page }) => {
  await page.goto("/#/rates/current");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveText([/Everyday Current/]);
  await checkScreen(page, "rates-current");
});
