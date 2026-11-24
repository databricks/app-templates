import {
  makeAssistantToolUI,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useMessageTiming,
  useThreadViewport,
} from "@assistant-ui/react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { ConnectionState } from "@/components/assistant-ui/elements/connection-state";
import { DaySeparatorHeader } from "@/components/assistant-ui/elements/day-separator";
import {
  EmptyState,
  EmptyStateGreeting,
  EmptyStateSuggestions,
} from "@/components/assistant-ui/elements/empty-state";
import { ErrorState } from "@/components/assistant-ui/elements/error-state";
import { FeedbackDialog } from "@/components/assistant-ui/elements/feedback-dialog";
import { GuardrailNotice } from "@/components/assistant-ui/elements/guardrail-notice";
import { MessageQueue } from "@/components/assistant-ui/elements/message-queue";
import { MessageTiming } from "@/components/assistant-ui/elements/message-timing";
import { StoppedRun } from "@/components/assistant-ui/elements/stopped-run";
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator";
import { Thread as AssistantThread, type ThreadComponents } from "@/components/assistant-ui/elements/thread.aui";
import { Button } from "@/components/ui/button";
import { COMPOSER_PLACEHOLDER, SUGGESTIONS } from "../../../config/suggestions";
import { dayLabel, formatTime } from "../../../lib/format";
import { CONFIRM_TOOL } from "../messages";
import type { MessageExtras, ProposalResult } from "../types";
import { ApprovalCard, type ConfirmArgs } from "./approval-card";
import { CitedText } from "./cited-text";
import { ComposerTools } from "./composer-tools";
import { Displays } from "./displays";
import { ContextUsage, RegenerateWith } from "./models";
import { RunGroup, RunStatusRow, THINKING } from "./run-timeline";
import { AnswerStatus, RUN_ERRORS, STILL_WRITING } from "./run-status";

const STOPPED = "Stopped by you";
const GUARDRAIL_EXPLANATION = "This request goes against a policy the assistant follows. You can ask something else instead.";
const GUARDRAIL_ALTERNATIVES = SUGGESTIONS.slice(0, 2).map(({ prompt }) => prompt);
const FEEDBACK_REASONS = ["Not correct", "Didn't answer my question", "Hard to follow", "Too long"];
const FEEDBACK_COMMENT_MAX_LENGTH = 2000;
const FEEDBACK_CLOSE_MS = 2600;

const SUGGESTION_CHIP =
  "border-foreground/10 hover:bg-foreground/[0.03] hover:border-foreground/25 h-auto rounded-md border px-2.5 py-1 text-sm font-normal whitespace-normal transition-colors ease-in max-md:min-h-11 motion-reduce:transition-none";

const COMPOSER_INPUT = '[data-slot="aui_composer-shell"] textarea';

/** Focus the composer after a keyboard click only: on a phone, focus hides the tab bar. */
function focusFromKeyboard(event?: MouseEvent) {
  if (event?.detail === 0) document.querySelector<HTMLTextAreaElement>(COMPOSER_INPUT)?.focus();
}

const ConfirmCard = makeAssistantToolUI<ConfirmArgs, ProposalResult>({
  toolName: CONFIRM_TOOL,
  display: "standalone",
  render: ({ toolCallId, args, result }) => <ApprovalCard toolCallId={toolCallId} args={args} result={result} />,
});

function Welcome() {
  return (
    <EmptyState className="mb-6 max-w-none items-start px-2">
      <EmptyStateGreeting className="text-start">How can I help?</EmptyStateGreeting>
    </EmptyState>
  );
}

/** The new chat's starters, as the demo's chips below the composer. Each puts its question in the composer. */
function Starters() {
  return (
    <EmptyStateSuggestions className="px-4">
      {SUGGESTIONS.map(({ label, prompt }) => (
        <ThreadPrimitive.Suggestion key={label} prompt={prompt} asChild>
          <Button variant="ghost" className={SUGGESTION_CHIP} onClick={focusFromKeyboard}>
            {label}
          </Button>
        </ThreadPrimitive.Suggestion>
      ))}
    </EmptyStateSuggestions>
  );
}

/**
 * "Thinking" below a display or a card once no step runs, while the run waits for the
 * model's next note, step or text. The thread renders it only while the message runs.
 */
function RunIndicator() {
  const waits = useAuiState((state) => {
    const parts = state.message.parts.filter((part) => part.type !== "source");
    const last = parts.at(-1);
    const isStepRunning = parts.some((part) => part.type === "tool-call" && part.toolName !== CONFIRM_TOOL && part.result === undefined);
    return !isStepRunning && (last?.type === "data" || (last?.type === "tool-call" && last.toolName === CONFIRM_TOOL));
  });
  return waits ? <ThinkingIndicator className="my-2 py-1 text-[13.5px]" label={THINKING} /> : null;
}

/** Why a run gave no answer and how to retry, a guardrail stop, a stopped or a resumed run. */
function RunNotice() {
  const aui = useAui();
  const extras = useAuiState((state) => state.message.metadata.custom as MessageExtras);
  const status = useAuiState((state) => state.message.status);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const retry = (event?: MouseEvent) => {
    focusFromKeyboard(event);
    aui.message.reload();
  };
  if (extras.error === "connection") return <ConnectionState className="mt-2" role="alert" onRetry={retry} />;
  if (extras.error === "guardrail") {
    return (
      <GuardrailNotice
        className="mt-2"
        role="alert"
        title={RUN_ERRORS.guardrail}
        explanation={GUARDRAIL_EXPLANATION}
        policy="policy"
        alternatives={isRunning ? [] : GUARDRAIL_ALTERNATIVES}
        onPick={(text) => aui.thread.append(text)}
      />
    );
  }
  if (extras.error) {
    return <ErrorState className="mt-2" title={RUN_ERRORS[extras.error]} retrying={isRunning} onRetry={retry} />;
  }
  if (status?.type === "incomplete" && status.reason === "cancelled") {
    return <StoppedRun className="mt-2" reason={STOPPED} onContinue={retry} />;
  }
  if (extras.resumed && status?.type === "running") {
    return (
      <p data-slot="run-note" className="text-muted-foreground mt-2 text-sm">
        {STILL_WRITING}
      </p>
    );
  }
  return null;
}

/**
 * Why an answer wasn't helpful: reasons and a note go to the rating as one comment.
 * A refused rating opens the form again.
 */
function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const aui = useAui();
  const rated = useAuiState((state) => state.message.metadata.submittedFeedback?.type === "negative");
  const composerHeight = useThreadViewport((viewport) => viewport.height.inset);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const sent = submitted && rated;
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(onClose, FEEDBACK_CLOSE_MS);
    return () => clearTimeout(id);
  }, [sent, onClose]);
  const toggle = (reason: string) =>
    setSelected((current) => (current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason]));
  const submit = () => {
    const comment = [...selected, note.trim()].filter(Boolean).join(". ").slice(0, FEEDBACK_COMMENT_MAX_LENGTH);
    aui.message.submitFeedback({ type: "negative", comment });
    setSubmitted(true);
  };
  return (
    <FeedbackDialog
      ref={panel}
      style={{ scrollMarginBottom: composerHeight }}
      className="mx-2 mt-2 w-auto"
      reasons={FEEDBACK_REASONS}
      selected={selected}
      note={note}
      sent={sent}
      onToggleReason={toggle}
      onNoteChange={setNote}
      onSubmit={submit}
    />
  );
}

/** The day a question was asked, above the first question of each day. */
function QuestionDay() {
  const day = useAuiState((state) => {
    const now = new Date();
    const label = dayLabel(state.message.createdAt.toISOString(), now);
    const earlier = state.thread.messages.slice(0, state.message.index).findLast((message) => message.role === "user");
    return earlier && dayLabel(earlier.createdAt.toISOString(), now) === label ? null : label;
  });
  return day ? <DaySeparatorHeader className="px-2" day={day} /> : null;
}

/** When the agent received the question, under it. */
function QuestionTime() {
  const sentAt = useAuiState((state) => (state.message.metadata.custom as MessageExtras).sentAt);
  if (!sentAt) return null;
  return (
    <time className="text-muted-foreground col-start-2 justify-self-end text-xs" dateTime={sentAt.toISOString()}>
      {formatTime(sentAt)}
    </time>
  );
}

/** How long the run worked before its answer, as the backend measured it. */
function WorkTime() {
  const timing = useMessageTiming();
  if (timing?.totalStreamTime === undefined) return null;
  const seconds = Math.round(timing.totalStreamTime / 1000);
  return <MessageTiming className="ms-auto pe-2" label="worked" value={`${seconds}s`} />;
}

/** The messages sent while an answer is being written, which go one at a time after it. */
function QueuedSends() {
  const aui = useAui();
  const queue = useAuiState((state) => state.composer.queue);
  const running = useAuiState(
    (state) =>
      state.thread.messages
        .findLast((message) => message.role === "user")
        ?.content.map((part) => (part.type === "text" ? part.text : ""))
        .join(" ") ?? "",
  );
  if (queue.length === 0) return null;
  return (
    <MessageQueue
      className="max-w-none"
      running={running}
      queued={queue.map((item) => ({ id: item.id, text: item.prompt }))}
      onCancel={(id) => aui.composer.queueItem({ id }).remove()}
    />
  );
}

const COMPONENTS: ThreadComponents = {
  Welcome,
  Text: CitedText,
  RunGroup,
  RunIndicator,
  Suggestions: Starters,
  AssistantMessageHeader: RunStatusRow,
  MessageNotice: RunNotice,
  FeedbackPanel,
  ComposerHeader: QueuedSends,
  ComposerTools,
  ComposerStatus: ContextUsage,
  RegenerateWith,
  UserMessageHeader: QuestionDay,
  UserMessageFooter: QuestionTime,
  AssistantMessageFooter: WorkTime,
  composerPlaceholder: COMPOSER_PLACEHOLDER,
};

type ThreadProps = { prefill: string | null; onPrefilled: () => void };

/**
 * The conversation and composer. A prefilled question goes into the composer unsent; the
 * composer never takes focus on load, so a phone keeps its tab bar.
 */
export function Thread({ prefill, onPrefilled }: ThreadProps) {
  const aui = useAui();
  useEffect(() => {
    if (prefill === null) return;
    aui.composer.setText(prefill);
    document.querySelector<HTMLTextAreaElement>(COMPOSER_INPUT)?.focus();
    onPrefilled();
  }, [prefill, aui, onPrefilled]);
  return (
    <>
      <ConfirmCard />
      <Displays />
      <AssistantThread components={COMPONENTS} />
      <AnswerStatus />
    </>
  );
}
