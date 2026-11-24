import type { Page } from "@playwright/test";
import { called, checkScreen, expect, ok, type Reply, run, said, step, stepDone, test } from "./fixtures";
import { COMPOSER_PLACEHOLDER } from "../../src/config/suggestions";
import { ACCOUNTS } from "./mock-data";

const INVOKE = "POST /api/invocations";
const MODEL = called("model", "user", "agent_ops.sonnet_llm", "allowed");
const DISPUTE = { transaction_id: "TX-1003-899", reason_code: "UNRECOGNISED", note: "" };
const TRANSFER = { from_account_id: "ACC-1001", to_account_id: "ACC-1002", amount: "200.00" };
const DISPUTE_STEP = "Preparing your dispute of the ELECTROSHOP payment";
const TRANSFER_STEP = "Preparing your transfer to your Holiday fund";

function proposed(action: string, args: Record<string, string>): Reply {
  const label = action === "file_dispute" ? DISPUTE_STEP : TRANSFER_STEP;
  return run(
    MODEL,
    step("call_1", label),
    { type: "confirmation_required", proposal_id: "p1", action, args },
    stepDone("call_1"),
    said("It's waiting for your confirmation."),
  );
}

function decided(action: string, outcome: "allowed" | "denied" | "rejected_by_user", details = {}, reply = ""): Reply {
  const event = called(action, "user", `agent_ops.${action}`, outcome, { proposal_id: "p1", ...details });
  return run(event, reply ? said(reply) : []);
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(COMPOSER_PLACEHOLDER).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test.beforeEach(async ({ api }) => {
  api.reply("POST /api/sessions", { ...ok({ id: "c1", title: "Bank questions" }), status: 201 });
});

test("a transfer card names both accounts and the amount, ends in Transfer completed, and Accounts then shows both new balances", async ({
  page,
  api,
}) => {
  const moved: Record<string, string> = { "ACC-1001": "3040.15", "ACC-1002": "8700.00" };
  api.reply(
    "GET /api/me/accounts",
    ok(ACCOUNTS),
    ok(ACCOUNTS.map((account) => ({ ...account, balance: moved[account.account_id] ?? account.balance }))),
  );
  api.reply(
    INVOKE,
    proposed("transfer_between_own_accounts", TRANSFER),
    decided("transfer_between_own_accounts", "allowed", { status: "OK", reference: "TRF-1" }, "Transfer completed. Your reference is TRF-1."),
  );
  await page.goto("/");
  await ask(page, "Move 200 to my Holiday fund");

  const card = page.getByTestId("confirm-card");
  await expect(card.getByRole("heading", { name: "Transfer between your accounts" })).toBeVisible();
  await expect(card).toContainText("The transfer is immediate, and both balances update.");
  await expect(card.locator('[data-slot="approval-card-detail"]')).toHaveText([
    "FromCurrent account, ending 0101",
    "ToHoliday fund, ending 0102",
    "Amount€200.00",
  ]);
  await checkScreen(page, "confirm-transfer");

  await card.getByRole("button", { name: "Make transfer" }).click();
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText("Transfer completed. Your reference is TRF-1.");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" }).click();
  const accounts = page.getByRole("navigation", { name: "Your accounts" }).getByRole("link");
  await expect(accounts.nth(0)).toContainText("€3,040.15");
  await expect(accounts.nth(1)).toContainText("€8,700.00");
});

test("a transfer card wraps 80-character account names without horizontal overflow", async ({ page, api }) => {
  const long = (seed: string) => seed.repeat(80).slice(0, 80);
  api.reply(
    "GET /api/me/accounts",
    ok(ACCOUNTS.map((account) => ({ ...account, nickname: long(account.nickname.replaceAll(" ", "")) }))),
  );
  api.reply(INVOKE, proposed("transfer_between_own_accounts", TRANSFER));
  await page.goto("/");
  await ask(page, "Move 200 to my Holiday fund");

  await expect(page.getByTestId("confirm-card").locator('[data-slot="approval-card-detail"]').first()).toContainText(long("Currentaccount"));
  await checkScreen(page, "long-confirm-transfer");
});

test("a dispute card shows its reason and payment reference, and ends in Dispute filed", async ({ page, api }) => {
  api.reply(
    INVOKE,
    proposed("file_dispute", DISPUTE),
    decided("file_dispute", "allowed", { status: "OK", reference: "DSP-7" }, "Dispute filed. Your reference is DSP-7."),
  );
  await page.goto("/");
  await ask(page, "Dispute the ELECTROSHOP charge");

  const card = page.getByTestId("confirm-card");
  await expect(card.getByRole("heading", { name: "Dispute a card payment" })).toBeVisible();
  await expect(card.locator('[data-slot="approval-card-detail"]')).toHaveText([
    "ReasonUnrecognised payment",
    "Payment referenceTX-1003-899",
  ]);

  await card.getByRole("button", { name: "File dispute" }).click();
  await expect(card.locator('[data-slot="approval-card-receipt"]')).toHaveText("Dispute filed. Your reference is DSP-7.");
});

test("a dispute card names the payment by merchant, amount and date", async ({ page, api }) => {
  const booked = `${new Date().getFullYear()}-10-01`;
  api.reply(INVOKE, proposed("file_dispute", { merchant: "ELECTROSHOP", amount: "89.99", booked_on: booked, ...DISPUTE }));
  await page.goto("/");
  await ask(page, "Dispute the ELECTROSHOP charge");

  const card = page.getByTestId("confirm-card");
  await expect(card.locator('[data-slot="approval-card-detail"]')).toHaveText([
    "Paid toELECTROSHOP",
    "Amount€89.99",
    "Payment date1 October",
    "ReasonUnrecognised payment",
    "Payment referenceTX-1003-899",
  ]);
  await checkScreen(page, "confirm-dispute");
});

test("a dispute card keeps its field order when a replay reorders the event's keys", async ({ page, api }) => {
  const booked = `${new Date().getFullYear()}-10-01`;
  api.reply(
    INVOKE,
    proposed("file_dispute", {
      note: "I never ordered this",
      amount: "89.99",
      merchant: "ELECTROSHOP",
      booked_on: booked,
      reason_code: "UNRECOGNISED",
      transaction_id: "TX-1003-899",
    }),
  );
  await page.goto("/");
  await ask(page, "Dispute the ELECTROSHOP charge");

  await expect(page.getByTestId("confirm-card").locator('[data-slot="approval-card-detail"]')).toHaveText([
    "Paid toELECTROSHOP",
    "Amount€89.99",
    "Payment date1 October",
    "ReasonUnrecognised payment",
    "Your noteI never ordered this",
    "Payment referenceTX-1003-899",
  ]);
});

test("a transfer card keeps its field order when a replay reorders the event's keys", async ({ page, api }) => {
  api.reply(
    INVOKE,
    proposed("transfer_between_own_accounts", { amount: "200.00", to_account_id: "ACC-1002", from_account_id: "ACC-1001" }),
  );
  await page.goto("/");
  await ask(page, "Move 200 to my Holiday fund");

  await expect(page.getByTestId("confirm-card").locator('[data-slot="approval-card-detail"]')).toHaveText([
    "FromCurrent account, ending 0101",
    "ToHoliday fund, ending 0102",
    "Amount€200.00",
  ]);
});
