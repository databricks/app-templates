import { request } from "../../lib/api-client";
import type { AgentEvent } from "../../types/events";

export type Session = { id: string; title: string | null; last_activity_time?: string | null };

export type Decision = "approve" | "reject";

export type Effort = "low" | "medium" | "high";

export type ContentPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };

// User message, confirmation decision, or compact command
export type RunInput =
  | {
      messages: { role: "user"; content: string | ContentPart[] }[];
      replace?: true;
      model?: string;
      effort?: Effort;
    }
  | { confirm: { proposal_id: string; decision: Decision } }
  | { command: "compact" };

export type StoredRun = { id: string; input: RunInput; events: AgentEvent[] };

// Stored runs, fallback messages, and current running state
export type Conversation = {
  id: string;
  title: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  runs: StoredRun[];
  running: { id: string; status: "active" | "queued" } | null;
};

export const listSessions = () => request<Session[]>("/api/sessions");
// End run after current step, best effort with routing key
export const stopInvocation = (id: string, sessionId: string) =>
  request<{ stopped: boolean }>(`/api/invocations/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Routing-Key": sessionId },
    body: JSON.stringify({ session_id: sessionId }),
  });
export const getConversation = (id: string) => request<Conversation>(`/api/sessions/${encodeURIComponent(id)}`);

export const createSession = (title: string) =>
  request<Session>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

export const renameSession = (id: string, title: string) =>
  request<Session>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

export const deleteSession = (id: string) =>
  request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });

// Rate answer; server finds trace by conversation and run
export const sendFeedback = (conversationId: string, runId: string, helpful: boolean, comment?: string) =>
  request<void>("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, run_id: runId, helpful, comment }),
  });
