import { useAui, useAuiState } from "@assistant-ui/react";
import {
  BrainIcon,
  CheckIcon,
  LoaderIcon,
  type LucideIcon,
  type LucideProps,
  MessageSquareTextIcon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator";
import { ToolError } from "@/components/assistant-ui/elements/tool-error";
import { type TimelineStep, ToolTimeline } from "@/components/assistant-ui/elements/tool-timeline";
import { cn } from "@/lib/utils";
import type { ToolEvent } from "../../../types/events";
import { CONFIRM_TOOL } from "../messages";
import type { MessageExtras, StepState } from "../types";
import { RUN_ERRORS } from "./run-status";

export const THINKING = "Thinking";
export const WRITING = "Writing";
export const THOUGHTS = "Thoughts";
export const STEP_FAILED = "This step couldn't finish.";

const SLOW_READ = "QUERY_TIMEOUT";

type LineState = StepState | "stopped";

const STEP_STATE: Record<LineState, string> = {
  running: "In progress",
  done: "Done",
  failed: "Couldn't finish",
  stopped: "Stopped",
};

function Spinning({ className, ...props }: LucideProps) {
  return <LoaderIcon className={cn(className, "animate-spin motion-reduce:animate-none")} {...props} />;
}

const STATE_ICON: Record<LineState, LucideIcon> = {
  running: Spinning as LucideIcon,
  done: CheckIcon,
  failed: XIcon,
  stopped: MinusIcon,
};

/**
 * The timeline's label: what the run does while it runs, and what it did once
 * it ends, with the seconds its steps took on the server's clock when known.
 */
export function stepsLabel(steps: number, running: boolean, seconds?: number): string {
  if (steps === 0) return running ? THINKING : "Notes";
  if (running) return "Using tools";
  const used = `Used ${steps} ${steps === 1 ? "tool" : "tools"}`;
  return seconds === undefined ? used : `${used} · ${seconds}s`;
}

/** The whole seconds from the first step's start to the last step's end, at least 1, or undefined without times. */
function stepSeconds(lines: Line[]): number | undefined {
  const timed = lines.flatMap((line) =>
    line.kind === "step" && line.startedAt !== undefined && line.endedAt !== undefined ? [line] : [],
  );
  if (timed.length === 0) return undefined;
  const start = Math.min(...timed.map((line) => line.startedAt!));
  const end = Math.max(...timed.map((line) => line.endedAt!));
  return Math.max(1, Math.round((end - start) / 1000));
}

type Line =
  | { kind: "note"; id: string; text: string }
  | { kind: "thought"; id: string; text: string }
  | { kind: "step"; id: string; text: string; state: LineState; event?: ToolEvent; startedAt?: number; endedAt?: number };

type Part = { type: string; id?: string; text?: string; toolName?: string; toolCallId?: string; args?: unknown; result?: unknown; isError?: boolean; artifact?: unknown; timing?: { startedAt: number; completedAt?: number } };

function stepState(messageStatus: string | undefined, part: Part): LineState {
  if (part.result === undefined) return messageStatus === "running" ? "running" : "stopped";
  return part.isError ? "failed" : "done";
}

/** The group's notes, thoughts and steps in the order they arrived; cards and text stay out. */
function linesOf(parts: readonly Part[], messageStatus: string | undefined): Line[] {
  return parts.flatMap((part, index): Line[] => {
    if (part.type === "reasoning" && part.text) {
      const kind = part.id?.startsWith("thought-") ? "thought" : "note";
      return [{ kind, id: part.id ?? `note-${index}`, text: part.text }];
    }
    if (part.type !== "tool-call" || part.toolName === CONFIRM_TOOL) return [];
    const step = (part.args as { step?: string } | undefined)?.step ?? "";
    return [
      {
        kind: "step",
        id: part.toolCallId ?? `step-${index}`,
        text: step,
        state: stepState(messageStatus, part),
        event: part.artifact as ToolEvent | undefined,
        startedAt: part.timing?.startedAt,
        endedAt: part.timing?.completedAt,
      },
    ];
  });
}

/**
 * One row per note, thought and step. A step shows its `step` text, never the tool's name or
 * arguments; a failed step offers Retry while the turn can be replaced.
 */
function timelineSteps(lines: Line[], onRetry: (() => void) | undefined): TimelineStep[] {
  return lines.map((line) => {
    if (line.kind === "note") {
      return { id: line.id, icon: MessageSquareTextIcon, verb: <span data-slot="note">{line.text}</span> };
    }
    if (line.kind === "thought") {
      return {
        id: line.id,
        icon: BrainIcon,
        verb: (
          <span data-slot="thought" className="whitespace-pre-line">
            {line.text.trim()}
          </span>
        ),
      };
    }
    const failed = line.state === "failed";
    return {
      id: line.id,
      icon: STATE_ICON[line.state],
      verb: (
        <span data-slot="step" data-state={line.state}>
          {line.text}
          <span className="sr-only">, {STEP_STATE[line.state]}</span>
        </span>
      ),
      detail: failed ? (
        <ToolError
          className="max-w-none"
          name={line.text}
          message={line.event?.code === SLOW_READ ? RUN_ERRORS.slow : STEP_FAILED}
          onRetry={onRetry}
        />
      ) : undefined,
    };
  });
}

/**
 * A group's notes, thoughts and steps as one timeline: open while the run goes
 * on, then closed, unless the user chose, and working while its last line is.
 */
function RunTimeline({ lines, running, active, canRetry }: { lines: Line[]; running: boolean; active: boolean; canRetry: boolean }) {
  const aui = useAui();
  const [choice, setChoice] = useState<boolean | null>(null);
  const steps = timelineSteps(lines, canRetry ? () => aui.message.reload() : undefined);
  const count = lines.filter((line) => line.kind === "step").length;
  return (
    <ToolTimeline
      className="mb-3 max-w-none"
      steps={steps}
      streaming={active}
      open={choice ?? running}
      onOpenChange={setChoice}
      activeLabel={stepsLabel(count, true)}
      restingLabel={lines.every((line) => line.kind === "thought") ? THOUGHTS : stepsLabel(count, false, stepSeconds(lines))}
    />
  );
}

/**
 * Adjacent notes, thoughts and steps, placed where the first arrived so later content never moves.
 * A later run of them, as after a display, is its own group.
 */
export function RunGroup({ indices }: { indices: readonly number[] }) {
  const status = useAuiState((state) => state.message.status?.type);
  const parts = useAuiState((state) => state.message.parts) as readonly Part[];
  const canRetry = useAuiState((state) => !state.thread.isRunning && (state.message.metadata.custom as MessageExtras).canReplace === true);
  const running = status === "running";
  const lines = linesOf(
    indices.map((index) => parts[index]),
    status,
  );
  const isLast = indices.at(-1) === parts.findLastIndex((part) => part.type !== "source");
  const active = running && (isLast || lines.some((line) => line.kind === "step" && line.state === "running"));
  return <RunTimeline lines={lines} running={running} active={active} canRetry={canRetry} />;
}

/** "Thinking", or "Writing" once text streams, from run start until the first note or step. */
export function RunStatusRow() {
  const extras = useAuiState((state) => state.message.metadata.custom as MessageExtras);
  const status = useAuiState((state) => state.message.status?.type);
  const parts = useAuiState((state) => state.message.parts) as readonly Part[];
  if (status !== "running" || !extras.answers || linesOf(parts, status).length > 0) return null;
  const writing = parts.some((part) => part.type === "text");
  return <ThinkingIndicator className="mb-2 py-1 text-[13.5px]" label={writing ? WRITING : THINKING} />;
}
