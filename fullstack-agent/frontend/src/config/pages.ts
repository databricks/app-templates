import { type ReactNode, useMemo } from "react";
import type { IconName } from "../components/icons";
import { getProducts, type Product } from "../features/reference-data/api";
import { ReferenceDataPage } from "../features/reference-data/reference-data-page";
import { type Account, getAccounts } from "../features/user-data/api";
import { UserDataPage } from "../features/user-data/user-data-page";
import { type Loaded, useLoaded } from "../lib/api-client";
import type { CardData } from "./actions";

export type PageData = { accounts: Loaded<Account[]>; products: Loaded<Product[]> };

export type PageProps = { data: PageData; detail: string | null; onAsk: (question: string) => void };

type DataPage = { id: string; label: string; icon: IconName; component: (props: PageProps) => ReactNode };

export const PAGES = [
  { id: "accounts", label: "Accounts", icon: "wallet", component: UserDataPage },
  { id: "rates", label: "Rates", icon: "percent", component: ReferenceDataPage },
] as const satisfies readonly DataPage[];

// Load pages and cards data in parallel, and the user's own data again after each confirmed change
export function usePageData(confirmedChanges: number): { pages: PageData; cardData: CardData } {
  const accounts = useLoaded(getAccounts, confirmedChanges);
  const products = useLoaded(getProducts);
  const list = accounts.value;
  const cardData = useMemo(() => ({ accounts: list ?? [] }), [list]);
  return { pages: { accounts, products }, cardData };
}
