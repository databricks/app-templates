import { useSyncExternalStore } from "react";
import type { IconName } from "../components/icons";
import { PAGES } from "../config/pages";

export type Page = "assistant" | "activity" | (typeof PAGES)[number]["id"];

export type PageLink = { id: Page; label: string; icon: IconName };

export type Route = { page: Page; detail: string | null };

export function pageLinks(): PageLink[] {
  return [{ id: "assistant", label: "Assistant", icon: "chat" }, ...PAGES, { id: "activity", label: "Activity", icon: "history" }];
}

// Parse hash routes; unknown pages default to assistant.
export function parseRoute(hash: string): Route {
  const [page, ...rest] = hash.replace(/^#\/?/, "").split("/");
  if (!pageLinks().some((link) => link.id === page)) return { page: "assistant", detail: null };
  return { page: page as Page, detail: rest.length ? decodeURIComponent(rest.join("/")) : null };
}

export function href(page: Page, detail?: string): string {
  return detail ? `#/${page}/${encodeURIComponent(detail)}` : `#/${page}`;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, () => window.location.hash));
}
