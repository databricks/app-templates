import { request } from "../../lib/api-client";
import type { Identity, Outcome } from "../../types/events";

// Stored tool event with conversation context
export type ActivityRow = {
  activity_id: string;
  run_id: string;
  at: string;
  tool: string;
  identity: Identity;
  target: string;
  outcome: Outcome;
  status: string | null;
  reference: string | null;
  proposal_id: string | null;
  conversation_id: string | null;
  conversation_title: string | null;
};

export type ActivityPage = { rows: ActivityRow[]; next: string | null };

export const getActivity = (before?: string) =>
  request<ActivityPage>(before ? `/api/activity?before=${encodeURIComponent(before)}` : "/api/activity");
