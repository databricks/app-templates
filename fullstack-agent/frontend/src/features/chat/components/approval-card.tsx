import { ApprovalCard as ApprovalElement, type ApprovalState } from "@/components/assistant-ui/elements/approval-card";
import { Icon } from "../../../components/icons";
import { fieldValue } from "../../../config/actions";
import { actionText, cardFields, fieldLabel, resultText } from "../approval-text";
import { useChat } from "../chat-context";
import type { ProposalResult } from "../types";

export type ConfirmArgs = { action: string; args: Record<string, string> };

type ConfirmProps = { toolCallId: string; args: ConfirmArgs; result?: ProposalResult };

const WAITING = "Waiting for your confirmation";
const SENDING = "Sending your decision";
const OUTCOME_UNKNOWN = "We couldn't confirm the outcome. Use Try again below; the change won't be made twice.";

function approvalState(result?: ProposalResult): ApprovalState {
  if (!result) return "request";
  if (result.outcome === "pending") return "running";
  return result.outcome === "allowed" ? "done" : "denied";
}

/**
 * A proposed change for the user to confirm. No "always allow": every write is one confirmation.
 * When a decision removes the focused button, focus moves to the receipt.
 */
export const ApprovalCard = ({ toolCallId, args, result }: ConfirmProps) => {
  const { chat, cardData } = useChat();
  const text = actionText(args.action);
  const state = approvalState(result);
  const failed = result?.outcome === "failed";
  const subtitle = state === "done" ? "Completed" : state === "denied" && !failed ? "Not changed" : WAITING;
  const statusLabel =
    state === "running" ? SENDING : failed ? OUTCOME_UNKNOWN : result ? resultText(result, text) : "";
  const details = cardFields(args.args).map(([key, value]) => ({
    label: fieldLabel(key),
    value: fieldValue(key, value, cardData),
  }));
  return (
    <fieldset disabled={chat.isRunning} className="my-2 min-w-0 [&_button:disabled]:opacity-50">
      <ApprovalElement
        data-testid="confirm-card"
        data-state={failed ? "failed" : state}
        className="max-w-none"
        state={state}
        title={text.title}
        subtitle={subtitle}
        description={text.consequence}
        details={details}
        icon={<Icon name={text.icon} />}
        allowOnceLabel={text.approve}
        denyLabel="Cancel"
        statusLabel={statusLabel}
        onAllowOnce={() => chat.confirm(toolCallId, "approve")}
        onDeny={() => chat.confirm(toolCallId, "reject")}
      />
    </fieldset>
  );
};
