/** Signed-in user from /api/me. */
export const ME = {
  email: "customer.one@example.com",
  user_name: "customer.one@example.com",
  display_name: "Customer One",
};

export const ACCOUNTS = [
  {
    account_id: "ACC-1001",
    account_type: "CURRENT",
    nickname: "Current account",
    iban: "NL01RIVB0000100101",
    currency: "EUR",
    balance: "3240.15",
    credit_limit: null,
    status: "OPEN",
  },
  {
    account_id: "ACC-1002",
    account_type: "SAVINGS",
    nickname: "Holiday fund",
    iban: "NL01RIVB0000100102",
    currency: "EUR",
    balance: "8500.00",
    credit_limit: null,
    status: "OPEN",
  },
  {
    account_id: "ACC-1003",
    account_type: "CREDIT_CARD",
    nickname: "Credit card",
    iban: "NL01RIVB0000100103",
    currency: "EUR",
    balance: "-612.40",
    credit_limit: "3000.00",
    status: "OPEN",
  },
  {
    account_id: "ACC-1098",
    account_type: "SAVINGS",
    nickname: "Joint account",
    iban: "NL01RIVB0000100998",
    currency: "EUR",
    balance: null,
    credit_limit: null,
    status: "OPEN",
  },
];

export const PRODUCTS = [
  {
    product_id: "P-EASY-SAVER",
    name: "Easy Saver",
    type: "SAVINGS",
    rate_pct: "2.10",
    monthly_fee: "0.00",
    terms: "Variable rate. Withdraw any time.",
  },
  {
    product_id: "P-FIXED-12M",
    name: "Fixed Saver 12 months",
    type: "SAVINGS",
    rate_pct: "3.05",
    monthly_fee: "0.00",
    terms: "Fixed rate for 12 months. No withdrawals before maturity.",
  },
  {
    product_id: "P-EVERYDAY",
    name: "Everyday Current",
    type: "CURRENT",
    rate_pct: "0.00",
    monthly_fee: "0.00",
    terms: "No monthly fee.",
  },
  {
    product_id: "P-CLASSIC-CARD",
    name: "Classic Card",
    type: "CREDIT_CARD",
    rate_pct: "19.90",
    monthly_fee: "0.00",
    terms: "APR 19.9%. No annual fee.",
  },
];

/** Mocked responses for page-load routes. */
export const PAGE_REPLIES: Record<string, unknown> = {
  "GET /api/me/accounts": ACCOUNTS,
  "GET /api/products": PRODUCTS,
};

/** Tool name in mocked steps. */
export const READ_TOOL = "bank_data";

/** Answer text for conversation tests. */
export const ANSWER = "Your current account holds EUR 3,240.15.";

/** Nav pages between Assistant and Activity: link, route, heading. */
export const NAV_PAGES = [
  { link: "Accounts", route: "/#/accounts", heading: "Accounts" },
  { link: "Rates", route: "/#/rates", heading: "Rates" },
];

/** Links on pages that open new conversations with prefilled questions. */
export const ASK_LINKS = [
  { from: "/#/accounts", button: "Ask about this account", question: "Tell me about my Current account" },
  { from: "/#/rates", button: "Compare with my savings", question: "Can I earn more on my savings?" },
];

/** Activity test run: user read, app read, refused read, change. */
export const ACTIVITY = {
  question: "What are my balances and the savings rates?",
  answer: "Your current account holds EUR 3,240.15. The Easy Saver pays 2.10%.",
  model: "agent_ops.sonnet_llm",
  userRead: { tool: "bank_data", target: "agent_data.accounts", step: "Looking at your accounts", title: "Viewed your accounts" },
  appRead: { tool: "product_rates", target: "agent_reference.products", step: "Checking our savings rates", title: "Viewed product rates" },
  refusedRead: { tool: "bank_data", target: "agent_data.transactions", title: "Couldn't view your transactions" },
  change: {
    question: "Dispute the ELECTROSHOP charge",
    action: "file_dispute",
    target: "agent_ops.file_dispute",
    args: { transaction_id: "TX-1003-899", reason_code: "UNRECOGNISED", note: "" },
    approve: "File dispute",
    title: "Dispute a card payment",
    done: "Dispute filed",
    reference: "DSP-1",
    rule: "This payment has already been disputed.",
  },
};
