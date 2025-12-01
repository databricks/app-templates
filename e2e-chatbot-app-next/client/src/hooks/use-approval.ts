import { useState, useCallback } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@chat-template/core';
import { DATABRICKS_TOOL_CALL_ID } from '@chat-template/ai-sdk-providers/tools';

interface ApprovalSubmission {
  messageId: string;
  approvalRequestId: string;
  approve: boolean;
  reason?: string;
}

interface UseApprovalOptions {
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  addToolResult: UseChatHelpers<ChatMessage>['addToolResult'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
}

/**
 * Hook for handling MCP approval requests.
 *
 * When user approves/denies, this hook:
 * 1. Updates the tool call part with approval status
 * 2. Appends an mcp-approval-response part to the message
 * 3. Sends an empty user message to trigger continuation
 */
export function useApproval({
  setMessages,
  sendMessage,
  addToolResult,
  regenerate,
}: UseApprovalOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(
    null,
  );

  const submitApproval = useCallback(
    async ({
      messageId,
      approvalRequestId,
      approve,
      reason,
    }: ApprovalSubmission) => {
      setIsSubmitting(true);
      setPendingApprovalId(approvalRequestId);

      try {
        await addToolResult({
          tool: DATABRICKS_TOOL_CALL_ID,
          toolCallId: approvalRequestId,
          state: 'output-available',
          output: {
            approvalStatus: approve,
          },
        });
        // Send empty message to trigger continuation with updated messages
        await sendMessage({
          role: 'user',
          parts: [],
        });
      } catch (error) {
        console.error('Approval submission failed:', error);
      } finally {
        setIsSubmitting(false);
        setPendingApprovalId(null);
      }
    },
    [setMessages, sendMessage],
  );

  return { submitApproval, isSubmitting, pendingApprovalId };
}
