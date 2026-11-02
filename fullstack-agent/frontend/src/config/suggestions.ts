import { accountName, type CardData } from "./actions";

export const SUGGESTIONS = [
  { label: "Show my bank account balances", prompt: "What are the balances on my bank accounts?" },
  { label: "Find a better savings rate", prompt: "Is there a savings account with a better interest rate than mine?" },
  { label: "Report a payment I don't recognise", prompt: "I don't recognise a payment on my bank account. Can you help me report it?" },
  { label: "Transfer money between my accounts", prompt: "I'd like to transfer money between my bank accounts." },
];

export const COMPOSER_PLACEHOLDER = "Ask about your accounts";

// Mention items: accounts by name for `@` in the composer
export function mentionItems(data: CardData) {
  return data.accounts.map((account) => ({
    id: account.account_id,
    type: "account",
    label: accountName(account.account_id, data.accounts),
  }));
}
