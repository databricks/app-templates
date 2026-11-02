import type { ThreadMessageLike } from "@assistant-ui/react";
import { activityText } from "../activity/activity-text";
import type { ContentPart, Conversation, RunInput, StoredRun } from "./api";
import { applyEvent } from "./events";
import type { AgentMessage, MessageExtras, MessageItem, Proposal } from "./types";

type Part = Exclude<ThreadMessageLike["content"], string>[number];

export const CONFIRM_TOOL = "confirm_action";

const READ_SOURCE = "application/vnd.databricks.uc-object";

// Limit quote length to fit backend's cap
export const QUOTE_MAX_LENGTH = 500;

// Format question with quote and images as model content
export function questionContent(text: string, quote?: string, images: string[] = []): string | ContentPart[] {
  const quoted = quote ? `> ${quote.slice(0, QUOTE_MAX_LENGTH).replace(/\s+/g, " ").trim()}\n\n${text}` : text;
  if (images.length === 0) return quoted;
  return [{ type: "input_text", text: quoted }, ...images.map((url) => ({ type: "input_image" as const, image_url: url }))];
}

export function contentParts(content: string | ContentPart[]): { text: string; images: string[] } {
  if (typeof content === "string") return { text: content, images: [] };
  return {
    text: content.map((part) => (part.type === "input_text" ? part.text : "")).join(""),
    images: content.flatMap((part) => (part.type === "input_image" ? [part.image_url] : [])),
  };
}

function splitQuote(content: string): { text: string; quote?: string } {
  const match = /^> (.+)\n\n([\s\S]*)$/.exec(content);
  return match ? { quote: match[1], text: match[2] } : { text: content };
}

export function newMessage(role: AgentMessage["role"], status: AgentMessage["status"], texts: string[] = []): AgentMessage {
  const items = texts.map((text) => ({ kind: "text" as const, text }));
  return { id: crypto.randomUUID(), role, items, draft: "", proposals: [], status };
}

export function runMessage(id: string, invocationId: string, input?: RunInput): AgentMessage {
  const decides = input && "confirm" in input ? input.confirm.proposal_id : undefined;
  return { ...newMessage("assistant", "running"), id, input, decides, invocationId };
}

function questionOf(run: StoredRun): AgentMessage[] {
  const content = "messages" in run.input ? run.input.messages.at(-1)?.content : undefined;
  if (!content) return [];
  const receivedAt = run.events.find((event) => event.type === "received")?.data.at;
  const { text: sent, images } = contentParts(content);
  const { text, quote } = splitQuote(sent);
  const question = { ...newMessage("user", "complete", [text]), quote, images };
  return [{ ...question, sentAt: receivedAt ? new Date(receivedAt) : undefined }];
}

function storedMessages(conversation: Conversation): AgentMessage[] {
  return conversation.messages.map((item) => newMessage(item.role, "complete", [item.content]));
}

// Reconstruct runs with replay reducer; fallback to stored messages if no runs
export function loadedMessages(conversation: Conversation): AgentMessage[] {
  if (conversation.runs.length === 0) {
    return storedMessages(conversation).map((message) => ({ ...message, loaded: true }));
  }
  const shown = conversation.runs.reduce<StoredRun[]>((kept, run) => {
    if (!run.events.some((event) => event.type === "replaced")) return [...kept, run];
    const last = kept.findLastIndex((item) => "messages" in item.input);
    return [...kept.filter((_, index) => index !== last), run];
  }, []);
  const replayed = shown.reduce<AgentMessage[]>((list, run) => {
    const message = runMessage(crypto.randomUUID(), run.id, run.input);
    const started = [...list, ...questionOf(run), { ...message, lastEventId: run.events.at(-1)?.id }];
    return run.events.reduce((messages, event) => applyEvent(messages, message.id, event), started);
  }, []);
  return replayed.map((message) => ({ ...message, loaded: true }));
}

// Decision runs only shown if they fail or include text
export function isShown(message: AgentMessage): boolean {
  return !message.decides || message.status === "error" || message.items.some((item) => item.kind === "text");
}

// Convert message item to assistant-ui part format
function toPart(item: MessageItem, proposals: Proposal[]): Part[] {
  if (item.kind === "text") return [{ type: "text", text: item.text }];
  if (item.kind === "note" || item.kind === "thought") return [{ type: "reasoning", id: `${item.kind}-${item.id}`, text: item.text }];
  if (item.kind === "display") return [{ type: "data", id: item.id, name: item.view, data: item.payload }];
  if (item.kind === "card") {
    const proposal = proposals.find((candidate) => candidate.proposalId === item.proposalId);
    if (!proposal) return [];
    const args = { action: proposal.action, args: proposal.args };
    return [{ type: "tool-call", toolCallId: proposal.proposalId, toolName: CONFIRM_TOOL, args, result: proposal.result }];
  }
  const ending = item.state === "running" ? {} : { result: item.state, isError: item.state === "failed" };
  const timing = item.startedAt
    ? { timing: { startedAt: Date.parse(item.startedAt), completedAt: item.endedAt ? Date.parse(item.endedAt) : undefined } }
    : {};
  const step = { type: "tool-call", toolCallId: item.id, toolName: item.tool, args: { step: item.text }, artifact: item.event };
  return [{ ...step, ...timing, ...ending } as Part];
}

// Extract unique read sources from steps
function sourcesOf(items: MessageItem[]): Part[] {
  const reads = items.flatMap((item) =>
    item.kind === "step" && item.event?.outcome === "allowed" && !item.event.proposal_id ? [item.event] : [],
  );
  return reads.flatMap((read, index): Part[] => {
    const title = activityText(read)?.title;
    const isFirst = reads.findIndex((other) => other.target === read.target) === index;
    return title && isFirst ? [{ type: "source", sourceType: "document", id: read.target, title, mediaType: READ_SOURCE }] : [];
  });
}

// Convert message to assistant-ui format with parts, timing, and metadata
export function toThreadMessage(message: AgentMessage): ThreadMessageLike {
  const parts: Part[] = message.items.flatMap((item) => toPart(item, message.proposals));
  if (message.draft) parts.push({ type: "text", text: message.draft });
  parts.push(...sourcesOf(message.items));
  const asked = message.input && "messages" in message.input ? message.input : undefined;
  const extras: MessageExtras = {
    sentAt: message.sentAt,
    error: message.error,
    resumed: message.resumed,
    isNew: !message.loaded || message.resumed === true,
    canReplace: message.replaceable,
    answers: asked !== undefined,
    quote: message.quote ? { text: message.quote, messageId: "" } : undefined,
    model: asked?.model,
    images: asked !== undefined && contentParts(asked.messages[0].content).images.length > 0,
    contextTokens: message.contextTokens,
    canRate: message.role === "assistant" && message.status === "complete" && Boolean(message.invocationId),
  };
  if (message.role === "user") {
    const attachments = (message.images ?? []).map((image, index) => ({
      id: `${message.id}-image-${index}`,
      type: "image" as const,
      name: `Image ${index + 1}`,
      status: { type: "complete" as const },
      content: [{ type: "image" as const, image }],
    }));
    return { id: message.id, role: "user", content: parts, attachments, createdAt: message.sentAt, metadata: { custom: extras } };
  }
  const timing =
    message.workSeconds === undefined
      ? undefined
      : { streamStartTime: 0, totalStreamTime: message.workSeconds * 1000, totalChunks: 0, toolCallCount: 0 };
  const metadata = { custom: extras, timing, submittedFeedback: message.feedback };
  const status: ThreadMessageLike["status"] =
    message.status === "running"
      ? { type: "running" }
      : message.status === "error"
        ? { type: "incomplete", reason: message.error === "guardrail" ? "content-filter" : "error" }
        : message.status === "stopped"
          ? { type: "incomplete", reason: "cancelled" }
          : { type: "complete", reason: "stop" };
  return { id: message.id, role: "assistant", content: parts, status, metadata };
}
