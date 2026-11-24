import { type ThreadMessage, useAuiState } from "@assistant-ui/react";
import { useEffect, useState } from "react";
import { SUPPORT_NAME } from "../../../config/brand";
import { CONFIRM_TOOL } from "../messages";
import { SOURCE_MARKER } from "./cited-text";
import type { MessageExtras, RunError } from "../types";

export const RUN_ERRORS: Record<RunError, string> = {
  failed: "We couldn't complete your request. Try again.",
  refused: "The assistant is unavailable at the moment. Try again in a few minutes.",
  not_allowed: `The assistant isn't available for your account. Contact ${SUPPORT_NAME} for help.`,
  guardrail: "We can't help with that request.",
  connection: "Your connection was interrupted. Check your internet connection and try again.",
  slow: "The service is taking a while to answer. Check back in a moment.",
};

export const STILL_WRITING = "This answer is still in progress.";

export const COPIED = "Copied";

/** What the status region says for the thread's last message. */
function announcement(message: ThreadMessage | undefined): string {
  const extras = message?.metadata.custom as MessageExtras | undefined;
  if (message?.role !== "assistant" || !extras?.isNew) return "";
  if (message.status.type === "complete") {
    return message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join(" ")
      .replace(SOURCE_MARKER, "")
      .trim();
  }
  if (message.status.type !== "running") return "";
  const step = message.content
    .filter((part) => part.type === "tool-call" && part.toolName !== CONFIRM_TOOL && part.result === undefined)
    .at(-1);
  return step?.type === "tool-call" ? String(step.args.step) : extras.resumed ? STILL_WRITING : "";
}

/**
 * Screen reader announcements: the current step, then each finished answer once, never while
 * it streams. Answers of a loaded conversation stay quiet.
 */
export function AnswerStatus() {
  const text = useAuiState((state) => announcement(state.thread.messages.at(-1)));
  const isCopied = useAuiState((state) => state.thread.messages.some((message) => message.isCopied));
  const [saysCopied, setSaysCopied] = useState(false);
  useEffect(() => setSaysCopied(false), [text]);
  useEffect(() => {
    if (isCopied) setSaysCopied(true);
  }, [isCopied]);
  return (
    <p data-slot="answer-status" className="sr-only" role="status">
      {saysCopied ? COPIED : text}
    </p>
  );
}
