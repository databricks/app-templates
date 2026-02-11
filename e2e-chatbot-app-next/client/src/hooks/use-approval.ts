import { useState, useCallback } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@chat-template/core';

interface ApprovalSubmission {
  approvalRequestId: string;
  approve: boolean;
}

interface UseApprovalOptions {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>['addToolApprovalResponse'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
}

/**
 * Hook for handling MCP approval requests.
 *
 * When user approves/denies, this hook:
 * 1. Adds the tool approval response via addToolApprovalResponse()
 * 2. Calls sendMessage() without arguments to trigger continuation (for approvals only)
 */
export function useApproval({
  addToolApprovalResponse,
  sendMessage,
}: UseApprovalOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(
    null,
  );

  const submitApproval = useCallback(
    async ({ approvalRequestId, approve }: ApprovalSubmission) => {
      setIsSubmitting(true);
      setPendingApprovalId(approvalRequestId);

      try {
        // Add tool approval response - this updates the AI SDK state
        await addToolApprovalResponse({
          id: approvalRequestId,
          approved: approve,
        });

        // Only trigger continuation for approvals
        // For denials, the AI SDK state is updated and we don't need server response
        if (approve) {
          // Trigger continuation by calling sendMessage without arguments
          // This will submit the current messages (including tool approval) without adding a new user message
          await sendMessage();
        }
      } catch (error) {
        console.error('Approval submission failed:', error);
      } finally {
        setIsSubmitting(false);
        setPendingApprovalId(null);
      }
    },
    [addToolApprovalResponse, sendMessage],
  );

  return {
    submitApproval,
    isSubmitting,
    pendingApprovalId,
  };
}
