import type { AgentEvent, ToolEvent } from "../../types/events";
import type { AgentMessage, MessageItem, Proposal, ProposalResult, RunError, StepState, ThinkingStep } from "./types";

const MODEL_NOT_ALLOWED = "NOT_ALLOWED";
const POLICY_BLOCKED = "POLICY_BLOCKED";
const FAILED = { status: "error", error: "failed" } as const;

function refusal(status: string | undefined): RunError {
  if (status === MODEL_NOT_ALLOWED) return "not_allowed";
  return status === POLICY_BLOCKED ? "guardrail" : "refused";
}

// Insert or replace note/thought, appending if new
function withNote(items: MessageItem[], kind: "note" | "thought", id: number, text: string): MessageItem[] {
  const note = { kind, id, text };
  const isNote = (item: MessageItem) => item.kind === kind && item.id === id;
  return items.some(isNote) ? items.map((item) => (isNote(item) ? note : item)) : [...items, note];
}

function changeSteps(items: MessageItem[], change: (step: ThinkingStep) => ThinkingStep, id?: string): MessageItem[] {
  return items.map((item) => (item.kind === "step" && (id === undefined || item.id === id) ? change(item) : item));
}

// Mark running steps as done or failed
export function endSteps(items: MessageItem[], state: StepState): MessageItem[] {
  return changeSteps(items, (step) => (step.state === "running" ? { ...step, state } : step));
}

// Mark message complete, end running steps, determine final status
function completed(message: AgentMessage): AgentMessage {
  const status = message.status === "stopped" ? "stopped" : message.error ? "error" : "complete";
  return { ...message, status, items: endSteps(message.items, "done") };
}

export function changeProposal(list: AgentMessage[], proposalId: string, change: (proposal: Proposal) => Proposal): AgentMessage[] {
  return list.map((message) =>
    message.proposals.some((proposal) => proposal.proposalId === proposalId)
      ? {
          ...message,
          proposals: message.proposals.map((proposal) => (proposal.proposalId === proposalId ? change(proposal) : proposal)),
        }
      : message,
  );
}

// Apply decision outcome to card if pending
function endDecision(list: AgentMessage[], proposalId: string | undefined, result?: ProposalResult): AgentMessage[] {
  if (!proposalId) return list;
  return changeProposal(list, proposalId, (proposal) =>
    proposal.result?.outcome === "pending" ? { ...proposal, result } : proposal,
  );
}

// Apply stream event to message for live and replay display
export function applyEvent(list: AgentMessage[], messageId: string, event: AgentEvent): AgentMessage[] {
  const message = list.find((item) => item.id === messageId);
  if (!message) return list;
  const data = event.data;
  const changed = (next: AgentMessage) => list.map((item) => (item.id === messageId ? next : item));
  switch (event.type) {
    case "run.started": {
      const pending = (proposal: Proposal): Proposal => ({ ...proposal, result: { outcome: "pending" } });
      return message.decides ? changeProposal(list, message.decides, pending) : list;
    }
    case "delta":
      return message.quiet ? list : changed({ ...message, draft: message.draft + data.content });
    case "narration":
      return message.quiet ? list : changed({ ...message, items: withNote(message.items, "note", data.id, data.text), draft: "" });
    case "reasoning":
      return message.quiet ? list : changed({ ...message, items: withNote(message.items, "thought", data.id, data.text) });
    case "status": {
      const isShownStep = message.items.some((item) => item.kind === "step" && item.id === data.step);
      if (!data.step || !data.text || isShownStep) return list;
      const step: ThinkingStep = {
        kind: "step",
        id: data.step,
        tool: data.tool,
        text: data.text,
        state: "running",
        startedAt: data.at,
      };
      return changed({ ...message, items: [...message.items, step] });
    }
    case "step.done": {
      const finish = (step: ThinkingStep): ThinkingStep => ({
        ...step,
        endedAt: data.at,
        state: step.state === "running" ? "done" : step.state,
      });
      return changed({ ...message, items: changeSteps(message.items, finish, data.step) });
    }
    case "work.done":
      return changed({ ...message, workSeconds: data.seconds });
    case "message": {
      if (message.quiet || data.message.role !== "assistant" || !data.message.content) return list;
      return changed({ ...message, items: [...message.items, { kind: "text", text: data.message.content }], draft: "" });
    }
    case "confirmation_required": {
      if (list.some((item) => item.proposals.some((proposal) => proposal.proposalId === data.proposal_id))) return list;
      const proposal = { proposalId: data.proposal_id, action: data.action, args: data.args };
      const card = { kind: "card" as const, proposalId: data.proposal_id };
      return changed({ ...message, proposals: [...message.proposals, proposal], items: [...message.items, card] });
    }
    case "display": {
      if (message.items.some((item) => item.kind === "display" && item.id === data.call_id)) return list;
      const display = { kind: "display" as const, id: data.call_id, view: data.view, payload: data.payload };
      return changed({ ...message, items: [...message.items, display] });
    }
    case "tool_event": {
      const refused = data.tool === "model" && data.outcome === "denied";
      const slow = data.code === "QUERY_TIMEOUT";
      const mark = (step: ThinkingStep): ThinkingStep => ({
        ...step,
        event: data as ToolEvent,
        state: data.outcome === "allowed" ? step.state : "failed",
      });
      const next = changed({
        ...message,
        quiet: message.quiet || refused || Boolean(data.proposal_id),
        ...(data.call_id ? { items: changeSteps(message.items, mark, data.call_id) } : {}),
        ...(refused ? { error: refusal(data.status), draft: "" } : {}),
        ...(slow ? { error: "slow", draft: "" } : {}),
      });
      return data.proposal_id
        ? changeProposal(next, data.proposal_id, (proposal) => ({ ...proposal, result: data as ProposalResult }))
        : next;
    }
    case "run.failed": {
      if (message.status !== "running") return list;
      const failed = changed({ ...message, ...FAILED, items: endSteps(message.items, "failed") });
      return endDecision(failed, message.decides, { outcome: "failed" });
    }
    case "stopped":
      return changed({
        ...message,
        status: "stopped",
        items: message.draft ? [...message.items, { kind: "text", text: message.draft }] : message.items,
        draft: "",
      });
    case "usage":
      return changed({ ...completed(message), contextTokens: data.context_tokens ?? 0 });
    case "run.completed":
      return endDecision(changed(completed(message)), message.decides);
    default:
      return list;
  }
}
