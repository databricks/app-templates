import type { IconName } from "../../components/icons";
import { IDENTITY_LABEL, READ_TOOLS } from "../../config/tools";
import type { ToolEvent } from "../../types/events";
import { actionText, resultText } from "../chat/approval-text";

export type ActivityKind = "data" | "app" | "change";

export type ActivityText = { kind: ActivityKind; icon: IconName; title: string; detail?: string; badge: string };

// Convert tool event to Activity row text, or null for model calls and unknown tools
export function activityText(event: ToolEvent): ActivityText | null {
  const allowed = event.outcome === "allowed";
  const read = { kind: event.identity === "user" ? "data" : "app", badge: IDENTITY_LABEL[event.identity] } as const;
  const tool = READ_TOOLS[event.tool];
  if (tool) return { ...read, icon: tool.icon, title: tool.title(event, allowed) };
  if (!event.proposal_id) return null;
  const action = actionText(event.tool);
  if (allowed) {
    const detail = event.reference ? `Reference ${event.reference}` : undefined;
    return { kind: "change", icon: action.icon, title: action.done, detail, badge: "Completed" };
  }
  const detail = event.outcome === "rejected_by_user" ? "You cancelled this change." : resultText(event, action);
  return { kind: "change", icon: action.icon, title: action.title, detail, badge: "Not changed" };
}
