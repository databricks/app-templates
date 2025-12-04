import { useState, useCallback } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@chat-template/core';
import { DATABRICKS_TOOL_CALL_ID } from '@chat-template/ai-sdk-providers/tools';
import { createApprovalStatusOutput } from '@chat-template/ai-sdk-providers/mcp';

interface ApprovalSubmission {
  approvalRequestId: string;
  approve: boolean;
}

interface UseApprovalOptions {
  addToolResult: UseChatHelpers<ChatMessage>['addToolResult'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
}

/**
 * Hook for handling MCP approval requests.
 *
 * When user approves/denies, this hook:
 * 1. Adds the tool result with approval status via addToolResult()
 * 2. Calls sendMessage() without arguments to trigger continuation
 */
export function useApproval({
  addToolResult,
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
        // Add tool result with approval status
        await addToolResult({
          tool: DATABRICKS_TOOL_CALL_ID,
          toolCallId: approvalRequestId,
          state: 'output-available',
          output: createApprovalStatusOutput(approve),
        });

        // Trigger continuation by calling sendMessage without arguments
        // This will submit the current messages (including tool result) without adding a new user message
        await sendMessage();
      } catch (error) {
        console.error('Approval submission failed:', error);
      } finally {
        setIsSubmitting(false);
        setPendingApprovalId(null);
      }
    },
    [addToolResult, sendMessage],
  );

  return { submitApproval, isSubmitting, pendingApprovalId };
}
