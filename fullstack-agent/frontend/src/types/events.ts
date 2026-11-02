export type AgentEvent = { id: number; type: string; data: Record<string, any> };

export type Identity = "user" | "app";

export type Outcome = "allowed" | "denied" | "rejected_by_user";

export type ToolEvent = {
  id: string;
  at: string;
  tool: string;
  identity: Identity;
  target: string;
  outcome: Outcome;
  status?: string;
  reference?: string;
  error?: string;
  code?: string;
  proposal_id?: string;
  call_id?: string;
};

// Tool event with run and conversation context; conversationId null if deleted
export type ActivityEvent = ToolEvent & { runId: string; conversationId: string | null; conversationTitle: string | null };
