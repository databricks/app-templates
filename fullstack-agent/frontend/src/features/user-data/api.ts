import { request } from "../../lib/api-client";

export type Account = {
  account_id: string;
  account_type: string;
  nickname: string;
  iban: string;
  currency: string;
  balance: string | null;
  credit_limit: string | null;
  status: string;
};

export const getAccounts = () => request<Account[]>("/api/me/accounts");
