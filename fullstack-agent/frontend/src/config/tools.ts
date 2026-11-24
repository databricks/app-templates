import type { IconName } from "../components/icons";
import type { Identity, ToolEvent } from "../types/events";

export const IDENTITY_LABEL: Record<Identity, string> = { user: "Your data", app: "Bank information" };

export const ACTIVITY_EMPTY = "No activity yet. Account checks and changes you confirm appear here.";

const SOURCES: Record<string, string> = {
  accounts: "your accounts",
  transactions: "your transactions",
  disputes: "your disputes",
  customers: "your contact details",
  action_audit: "your change history",
};
const OTHER_SOURCE = "your account information";

function sourceName(event: ToolEvent): string {
  return SOURCES[event.target.split(".").at(-1) ?? ""] ?? OTHER_SOURCE;
}

export const READ_TOOLS: Record<string, { icon: IconName; title: (event: ToolEvent, allowed: boolean) => string }> = {
  bank_data: {
    icon: "eye",
    title: (event, allowed) => {
      const source = sourceName(event);
      return allowed ? `Viewed ${source}` : `Couldn't view ${source}`;
    },
  },
  product_rates: {
    icon: "building",
    title: (_event, allowed) => (allowed ? "Viewed product rates" : "Couldn't view product rates"),
  },
};
