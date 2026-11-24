import type { Outcome, ToolEvent } from "../../types/events";
import type { RunInput } from "./api";

// Proposal outcome or pending/failed state
export type ProposalResult = {
  outcome: Outcome | "pending" | "failed";
  status?: string;
  reference?: string;
  error?: string;
};

export type Proposal = {
  proposalId: string;
  action: string;
  args: Record<string, string>;
  result?: ProposalResult;
};

export type RunError = "failed" | "refused" | "not_allowed" | "guardrail" | "connection" | "slow";

export type StepState = "running" | "done" | "failed";

// Model-labeled step with tool event and server timestamps
export type ThinkingStep = {
  kind: "step";
  id: string;
  tool: string;
  text: string;
  state: StepState;
  event?: ToolEvent;
  startedAt?: string;
  endedAt?: string;
};

export type DisplayItem = { kind: "display"; id: string; view: string; payload: Record<string, unknown> };

export type MessageItem =
  | { kind: "text"; text: string }
  | { kind: "note"; id: number; text: string }
  | { kind: "thought"; id: number; text: string }
  | ThinkingStep
  | { kind: "card"; proposalId: string }
  | DisplayItem;

// Chat message: finished items, streaming draft, proposal state, and metadata
export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  items: MessageItem[];
  draft: string;
  workSeconds?: number;
  proposals: Proposal[];
  status: "running" | "complete" | "error" | "stopped";
  error?: RunError;
  sentAt?: Date;
  input?: RunInput;
  decides?: string;
  quiet?: boolean;
  loaded?: boolean;
  resumed?: boolean;
  invocationId?: string;
  lastEventId?: number;
  quote?: string;
  images?: string[];
  contextTokens?: number;
  replaceable?: boolean;
  feedback?: Feedback;
};

export type Feedback = { type: "positive" | "negative"; comment?: string };

// Extra message fields: state, model, and rating metadata for UI rendering
export type MessageExtras = {
  sentAt?: Date;
  error?: RunError;
  resumed?: boolean;
  isNew: boolean;
  canReplace?: boolean;
  answers?: boolean;
  quote?: { text: string; messageId: string };
  model?: string;
  images?: boolean;
  contextTokens?: number;
  canRate?: boolean;
};

export type ConversationState = "new" | "loading" | "ready" | "missing" | "failed";
