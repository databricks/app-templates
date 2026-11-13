import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { href, parseRoute } from "../../app/router";
import { ApiError } from "../../lib/api-client";
import { ConnectionLost, resumeInvocation, streamInvocation } from "../../lib/sse";
import type { ActivityEvent, AgentEvent, ToolEvent } from "../../types/events";
import {
  createSession,
  type Decision,
  deleteSession,
  type Effort,
  getConversation,
  listSessions,
  type RunInput,
  renameSession,
  type Session,
  sendFeedback,
  stopInvocation,
} from "./api";
import { applyEvent, changeProposal, endSteps } from "./events";
import { contentParts, isShown, loadedMessages, newMessage, questionContent, runMessage } from "./messages";
import type { AgentMessage, ConversationState, Feedback, Proposal, RunError } from "./types";

export const TITLE_MAX_LENGTH = 120;
const RENAME_FAILED = "We couldn't rename the conversation. Try again in a few minutes.";
const DELETE_FAILED = "We couldn't delete the conversation. Try again in a few minutes.";
const DELETE_ANSWERING = "We can't delete a conversation while it's being answered. Try again when the answer is done.";

// Check if run is still active; fails count as no for safe retry
async function isStillRunning(sessionId: string, invocationId: string): Promise<boolean> {
  try {
    return (await getConversation(sessionId)).running?.id === invocationId;
  } catch (error) {
    if (error instanceof ApiError || error instanceof TypeError) return false;
    throw error;
  }
}

function titleOf(input: RunInput): string {
  return "messages" in input ? contentParts(input.messages[0].content).text.slice(0, TITLE_MAX_LENGTH) : "";
}

// Last turn eligible for edit or regenerate (complete answer, no proposals)
function replaceableTurn(list: AgentMessage[]): [AgentMessage, AgentMessage] | undefined {
  const [question, answer] = list.slice(-2);
  if (question?.role !== "user" || answer?.role !== "assistant") return undefined;
  if (answer.status !== "complete" || answer.error || answer.proposals.length > 0) return undefined;
  if (!answer.input || !("messages" in answer.input)) return undefined;
  return [question, answer];
}

// Active stream run with abort control
type ActiveRun = { controller: AbortController; messageId: string; decides?: string; invocationId: string; session: string };

// Resume existing run from last event
type Resume = { id: string; after: number; messageId?: string };

// Manage open conversation, runs, and message state
export function useAgentChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const [state, setState] = useState<ConversationState>("new");
  const [title, setTitle] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsFailed, setSessionsFailed] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [effort, setEffort] = useState<Effort>("low");
  const active = useRef<ActiveRun | null>(null);
  const latest = useRef<AgentMessage[]>([]);

  useEffect(() => {
    latest.current = messages;
  }, [messages]);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setSessionsFailed(false);
    } catch {
      setSessionsFailed(true);
    }
    setSessionsLoaded(true);
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const update = (id: string, change: (message: AgentMessage) => AgentMessage) =>
    setMessages((list) => list.map((message) => (message.id === id ? change(message) : message)));

  const updateProposal = (proposalId: string, change: (proposal: Proposal) => Proposal) =>
    setMessages((list) => changeProposal(list, proposalId, change));

  // Stream invocation events to message, record activity, resume from last event
  const run = useCallback(async (session: string, title: string | null, input?: RunInput, resume?: Resume, waitingId?: string) => {
    const invocationId = resume?.id ?? crypto.randomUUID();
    const created = runMessage(resume?.messageId ?? waitingId ?? crypto.randomUUID(), invocationId, input);
    const assistantId = created.id;
    const controller = new AbortController();
    active.current = { controller, messageId: assistantId, decides: created.decides, invocationId, session };
    if (resume?.messageId) {
      update(assistantId, (message) => ({ ...message, status: "running", error: undefined, resumed: true }));
    } else if (waitingId) {
      update(assistantId, () => created);
    } else {
      setMessages((list) => [...list, { ...created, resumed: resume !== undefined }]);
    }
    setIsRunning(true);
    let lastId = resume?.after ?? 0;
    let answered = false;
    const apply = (event: AgentEvent) => {
      if (controller.signal.aborted) return;
      lastId = Math.max(lastId, event.id);
      setMessages((list) => applyEvent(list, assistantId, event));
      answered ||= event.type === "usage";
      if (event.type === "usage" && active.current?.controller === controller) {
        active.current = null;
        setIsRunning(false);
      }
      if (event.type === "tool_event") {
        const row = { ...(event.data as ToolEvent), id: `${invocationId}:${event.id}` };
        setActivity((rows) => [...rows, { ...row, runId: invocationId, conversationId: session, conversationTitle: title }]);
      }
    };
    try {
      if (resume) await resumeInvocation(resume.id, session, apply, controller.signal, resume.after);
      else if (input) await streamInvocation({ id: invocationId, session_id: session, input }, apply, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted && !answered) {
        const reason: RunError = error instanceof ConnectionLost || !navigator.onLine ? "connection" : "failed";
        update(assistantId, (message) => ({
          ...message,
          status: "error",
          error: reason,
          lastEventId: lastId,
          items: reason === "connection" ? message.items : endSteps(message.items, "failed"),
        }));
      }
    } finally {
      if (active.current?.controller === controller) {
        active.current = null;
        setIsRunning(false);
      }
    }
  }, []);

  // Abort stream locally; run may finish on server
  const stop = useCallback(() => {
    const stopped = active.current;
    if (!stopped || stopped.decides) return;
    stopped.controller.abort();
    stopInvocation(stopped.invocationId, stopped.session).catch(() => undefined);
    active.current = null;
    setIsRunning(false);
    update(stopped.messageId, (message) => ({
      ...message,
      status: "stopped",
      items: message.draft ? [...message.items, { kind: "text", text: message.draft }] : message.items,
      draft: "",
    }));
  }, []);

  // Load conversation and resume unfinished runs
  const load = useCallback(
    async (id: string) => {
      setState("loading");
      try {
        const conversation = await getConversation(id);
        if (current.current !== id) return;
        const loaded = loadedMessages(conversation);
        setTitle(conversation.title);
        setMessages(loaded);
        setState("ready");
        const unfinished = loaded.find((message) => message.status === "running" && message.invocationId);
        if (unfinished?.invocationId) {
          const resume = { id: unfinished.invocationId, after: unfinished.lastEventId ?? 0, messageId: unfinished.id };
          run(id, conversation.title, unfinished.input, resume);
        }
      } catch (error) {
        if (current.current !== id) return;
        setState(error instanceof ApiError && error.status === 404 ? "missing" : "failed");
      }
    },
    [run],
  );

  // Switch conversation, stop local stream, resume on reopen
  const open = useCallback(
    (id: string | null) => {
      if (id === current.current) return;
      active.current?.controller.abort();
      active.current = null;
      setIsRunning(false);
      current.current = id;
      setSessionId(id);
      setMessages([]);
      setTitle(null);
      if (id === null) setState("new");
      else load(id);
    },
    [load],
  );

  const reload = useCallback(() => {
    if (current.current !== null) load(current.current);
  }, [load]);

  // Create conversation if needed, show waiting state, run input
  const answer = useCallback(
    async (input: RunInput) => {
      let session = current.current;
      let sessionTitle = title;
      let waitingId: string | undefined;
      if (session === null) {
        const waiting = runMessage(crypto.randomUUID(), "", input);
        waitingId = waiting.id;
        setMessages((list) => [...list, waiting]);
        setIsRunning(true);
        let created: Session;
        try {
          created = await createSession(titleOf(input));
        } catch (error) {
          if (current.current !== null) return;
          const reason: RunError = error instanceof TypeError || !navigator.onLine ? "connection" : "failed";
          update(waiting.id, () => ({ ...newMessage("assistant", "error"), id: waiting.id, error: reason, input }));
          setIsRunning(false);
          return;
        }
        if (current.current !== null) return;
        session = created.id;
        sessionTitle = created.title;
        current.current = session;
        setSessionId(session);
        setTitle(created.title);
        setState("ready");
        setSessions((list) => [{ ...created, last_activity_time: new Date().toISOString() }, ...list]);
        if (parseRoute(window.location.hash).page === "assistant") window.location.replace(href("assistant", session));
      }
      await run(session, sessionTitle, input, undefined, waitingId);
      refreshSessions();
    },
    [run, refreshSessions, title],
  );

  // Send question with quote and images on chosen model
  const send = useCallback(
    async (text: string, quote?: string, images: string[] = []) => {
      setMessages((list) => [...list, { ...newMessage("user", "complete", [text]), quote, images, sentAt: new Date() }]);
      await answer({ messages: [{ role: "user", content: questionContent(text, quote, images) }], model, effort });
    },
    [answer, model, effort],
  );

  // Regenerate with optional model or edit with new text, respecting image model support
  const replace = useCallback(
    async (text?: string, otherModel?: string) => {
      const turn = replaceableTurn(latest.current);
      if (!turn) return;
      const [question, { input }] = turn;
      if (!input || !("messages" in input)) return;
      if (text === undefined) {
        setMessages((list) => [...list.slice(0, -2), question]);
        await answer({ ...input, replace: true, model: otherModel ?? input.model });
        return;
      }
      const edited = { ...newMessage("user", "complete", [text]), quote: question.quote, images: question.images };
      setMessages((list) => [...list.slice(0, -2), { ...edited, sentAt: new Date() }]);
      const content = questionContent(text, question.quote, question.images);
      const editModel = question.images?.length ? input.model : model;
      await answer({ messages: [{ role: "user", content }], replace: true, model: editModel, effort });
    },
    [answer, model, effort],
  );

  // Summarize older messages for model; UI shows all
  const compact = useCallback(async () => {
    if (current.current !== null) await answer({ command: "compact" });
  }, [answer]);

  // Submit decision; backend uses idempotency key for safe retry
  const confirm = useCallback(
    async (proposalId: string, decision: Decision) => {
      const session = current.current;
      if (session === null) return;
      updateProposal(proposalId, (proposal) => ({ ...proposal, result: { outcome: "pending" } }));
      await run(session, title, { confirm: { proposal_id: proposalId, decision } });
      updateProposal(proposalId, (proposal) =>
        proposal.result?.outcome === "pending" ? { ...proposal, result: { outcome: "failed" } } : proposal,
      );
    },
    [run, title],
  );

  // Retry failed/stopped run; resume if still active on server, replace if stopped
  const retry = useCallback(
    async (messageId: string) => {
      const failed = latest.current.find((message) => message.id === messageId);
      const input = failed?.input;
      if (!failed || !input) return;
      const session = current.current;
      if (
        session !== null &&
        failed.error === "connection" &&
        failed.invocationId &&
        "messages" in input &&
        (await isStillRunning(session, failed.invocationId))
      ) {
        const after = failed.lastEventId ?? 0;
        await run(session, title, input, { id: failed.invocationId, after, messageId });
        return;
      }
      setMessages((list) => list.filter((message) => message.id !== messageId));
      if ("confirm" in input) await confirm(input.confirm.proposal_id, input.confirm.decision);
      else if ("messages" in input && failed.status === "stopped" && failed.proposals.length === 0) {
        await answer({ ...input, replace: true });
      }
      else await answer(input);
    },
    [answer, confirm, run, title],
  );

  const changeTitle = (id: string, title: string | null) =>
    setSessions((list) => list.map((session) => (session.id === id ? { ...session, title } : session)));

  // Rename conversation optimistically; revert on error
  const rename = useCallback(
    async (id: string, title: string) => {
      const previous = sessions.find((session) => session.id === id);
      if (!previous) return;
      changeTitle(id, title);
      setListError(null);
      try {
        await renameSession(id, title);
      } catch (error) {
        if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
        changeTitle(id, previous.title);
        setListError(RENAME_FAILED);
      }
    },
    [sessions],
  );

  // Delete conversation optimistically; revert on error, open new if current
  const remove = useCallback(
    async (id: string) => {
      const index = sessions.findIndex((session) => session.id === id);
      if (index === -1) return;
      const removed = sessions[index];
      setSessions((list) => list.filter((session) => session.id !== id));
      setListError(null);
      try {
        await deleteSession(id);
      } catch (error) {
        if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
        setSessions((list) =>
          list.some((session) => session.id === id) ? list : [...list.slice(0, index), removed, ...list.slice(index)],
        );
        setListError(error instanceof ApiError && error.status === 409 ? DELETE_ANSWERING : DELETE_FAILED);
        return;
      }
      if (current.current === id) window.location.replace(href("assistant"));
    },
    [sessions],
  );

  // Rate answer optimistically; revert on error
  const feedback = useCallback(async (messageId: string, rating: Feedback) => {
    const session = current.current;
    const rated = latest.current.find((message) => message.id === messageId);
    if (session === null || !rated?.invocationId) return;
    update(messageId, (message) => ({ ...message, feedback: rating }));
    try {
      await sendFeedback(session, rated.invocationId, rating.type === "positive", rating.comment);
    } catch (error) {
      if (!(error instanceof ApiError || error instanceof TypeError)) throw error;
      update(messageId, (message) => ({ ...message, feedback: rated.feedback }));
    }
  }, []);

  const shown = useMemo(() => {
    const turn = isRunning ? undefined : replaceableTurn(messages);
    return messages.filter(isShown).map((message) => (turn?.includes(message) ? { ...message, replaceable: true } : message));
  }, [messages, isRunning]);
  const canStop =
    isRunning &&
    messages.some((message) => message.status === "running" && message.invocationId && message.input && "messages" in message.input);
  const chat = useMemo(
    () => ({
      sessionId,
      state,
      title,
      sessions,
      sessionsFailed,
      sessionsLoaded,
      listError,
      isRunning,
      canStop,
      activity,
      model,
      setModel,
      effort,
      setEffort,
      open,
      reload,
      send,
      replace,
      compact,
      stop,
      confirm,
      retry,
      rename,
      remove,
      feedback,
    }),
    [
      sessionId,
      state,
      title,
      sessions,
      sessionsFailed,
      sessionsLoaded,
      listError,
      isRunning,
      canStop,
      activity,
      model,
      effort,
      open,
      reload,
      send,
      replace,
      compact,
      stop,
      confirm,
      retry,
      rename,
      remove,
      feedback,
    ],
  );

  return { chat, messages: shown };
}

export type AgentChat = ReturnType<typeof useAgentChat>["chat"];
