import type { ActionText } from "../features/chat/approval-text";
import type { Account } from "../features/user-data/api";
import { formatMoney, shortDate } from "../lib/format";

// Data for approval cards
export type CardData = { accounts: Account[] };

export const ACTIONS: Record<string, ActionText> = {
  file_dispute: {
    title: "Dispute a card payment",
    consequence: "We'll open a dispute on this payment. Each payment can be disputed only once.",
    approve: "File dispute",
    done: "Dispute filed",
    icon: "flag",
  },
  transfer_between_own_accounts: {
    title: "Transfer between your accounts",
    consequence: "The transfer is immediate, and both balances update.",
    approve: "Make transfer",
    done: "Transfer completed",
    icon: "transfer",
  },
  update_contact_details: {
    title: "Update your contact details",
    consequence: "These details will replace your current phone number and address.",
    approve: "Update details",
    done: "Contact details updated",
    icon: "user",
  },
};

export const FIELDS: Record<string, string> = {
  merchant: "Paid to",
  from_account_id: "From",
  to_account_id: "To",
  amount: "Amount",
  booked_on: "Payment date",
  reason_code: "Reason",
  note: "Your note",
  phone: "Phone number",
  address_line1: "Address",
  city: "City",
  postcode: "Postcode",
  transaction_id: "Payment reference",
};

const ACCOUNT_FIELDS = new Set(["from_account_id", "to_account_id"]);

const REASONS: Record<string, string> = {
  UNRECOGNISED: "Unrecognised payment",
  DUPLICATE: "Duplicate charge",
  WRONG_AMOUNT: "Incorrect amount",
  GOODS_NOT_RECEIVED: "Goods or services not received",
};

// Format field values for display; booking dates are read as local dates.
export function fieldValue(key: string, value: string, data: CardData): string {
  if (key === "reason_code") return REASONS[value] ?? value;
  if (key === "amount") return formatMoney("EUR", value);
  if (key === "booked_on") return shortDate(`${value}T00:00:00`, new Date());
  if (ACCOUNT_FIELDS.has(key)) return accountName(value, data.accounts);
  return value;
}

export function ending(iban: string): string {
  return iban.replace(/\s/g, "").slice(-4);
}

// Format account as nickname and IBAN ending
export function accountName(accountId: string, accounts: Account[]): string {
  const account = accounts.find((item) => item.account_id === accountId);
  return account ? `${account.nickname}, ending ${ending(account.iban)}` : accountId;
}
