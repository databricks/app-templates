import type { IconName } from "../../components/icons";
import { ACTIONS, FIELDS } from "../../config/actions";
import { capitalised } from "../../lib/format";
import type { ProposalResult } from "./types";

export type ActionText = { title: string; consequence: string; approve: string; done: string; icon: IconName };

const OTHER_ACTION: ActionText = {
  title: "Confirm this change",
  consequence: "Nothing changes until you confirm.",
  approve: "Confirm",
  done: "Change completed",
  icon: "info",
};

const FIELD_ORDER = Object.keys(FIELDS);

export function actionText(action: string): ActionText {
  return ACTIONS[action] ?? OTHER_ACTION;
}

// Format the outcome of a confirmed or rejected change
export function resultText(result: ProposalResult, text: ActionText): string {
  if (result.outcome === "allowed") {
    const done = result.status === "OK_REPLAYED" ? "This change was already made" : text.done;
    return `${done}. Your reference is ${result.reference}.`;
  }
  if (result.outcome === "denied") {
    return result.status === "REJECTED" && result.error ? result.error : "This change isn't permitted for you.";
  }
  return "Nothing was changed.";
}

// Card fields sorted by configured order, unknown fields last
export function cardFields(args: Record<string, string>): [string, string][] {
  const rank = (key: string) => (FIELD_ORDER.includes(key) ? FIELD_ORDER.indexOf(key) : FIELD_ORDER.length);
  return Object.entries(args)
    .filter(([, value]) => value !== "")
    .sort(([first], [second]) => rank(first) - rank(second));
}

export function fieldLabel(key: string): string {
  return FIELDS[key] ?? capitalised(key.replaceAll("_", " "));
}
