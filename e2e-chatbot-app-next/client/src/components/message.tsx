import React, { memo, useState } from 'react';
import { AnimatedAssistantIcon } from './animation-assistant-icon';
import { Response } from './elements/response';
import { MessageContent } from './elements/message';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  type ToolState,
} from './elements/tool';
import {
  McpTool,
  McpToolHeader,
  McpToolContent,
  McpToolInput,
  McpApprovalActions,
} from './elements/mcp-tool';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { MessageEditor } from './message-editor';
import { MessageReasoning } from './message-reasoning';
import { Shimmer } from './ui/shimmer';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage, Feedback } from '@chat-template/core';
import { useDataStream } from './data-stream-provider';
import {
  createMessagePartSegments,
  formatNamePart,
  isNamePart,
  joinMessagePartSegments,
} from './databricks-message-part-transformers';
import { MessageError } from './message-error';
import { MessageOAuthError } from './message-oauth-error';
import { isCredentialErrorMessage } from '@/lib/oauth-error-utils';
import { Streamdown } from 'streamdown';
import { useApproval } from '@/hooks/use-approval';

const PurePreviewMessage = ({
  message,
  allMessages,
  isLoading,
  setMessages,
  addToolApprovalResponse,
  sendMessage,
  regenerate,
  isReadonly,
  requiresScrollPadding,
  initialFeedback,
}: {
  message: ChatMessage;
  allMessages: ChatMessage[];
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>['addToolApprovalResponse'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  initialFeedback?: Feedback;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [showErrors, setShowErrors] = useState(false);

  // Hook for handling MCP approval requests
  const { submitApproval, isSubmitting, pendingApprovalId } = useApproval({
    addToolApprovalResponse,
    sendMessage,
  });

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === 'file',
  );

  // Extract non-OAuth error parts separately (OAuth errors are rendered inline)
  const errorParts = React.useMemo(
    () =>
      message.parts
        .filter((part) => part.type === 'data-error')
        .filter((part) => {
          // OAuth errors are rendered inline, not in the error section
          return !isCredentialErrorMessage(part.data);
        }),
    [message.parts],
  );

  useDataStream();

  const partSegments = React.useMemo(
    /**
     * We segment message parts into segments that can be rendered as a single component.
     * Used to render citations as part of the associated text.
     * Note: OAuth errors are included here for inline rendering, non-OAuth errors are filtered out.
     */
    () =>
      createMessagePartSegments(
        message.parts.filter(
          (part) =>
            part.type !== 'data-error' || isCredentialErrorMessage(part.data),
        ),
      ),
    [message.parts],
  );

  const renderBlocks = React.useMemo(
    () => groupConsecutiveToolSegments(partSegments),
    [partSegments],
  );

  // Check if message only contains non-OAuth errors (no other content)
  const hasOnlyErrors = React.useMemo(() => {
    const nonErrorParts = message.parts.filter(
      (part) => part.type !== 'data-error',
    );
    // Only consider non-OAuth errors for this check
    return errorParts.length > 0 && nonErrorParts.length === 0;
  }, [message.parts, errorParts.length]);

  return (
    <div
      data-testid={`message-${message.role}`}
      className="group/message w-full"
      data-role={message.role}
    >
      <div
        className={cn('flex w-full items-start gap-2 md:gap-3', {
          'justify-end': message.role === 'user',
          'justify-start': message.role === 'assistant',
        })}
      >
        {partSegments.length === 0 && errorParts.length === 0 && message.role === 'assistant' && (
          <AwaitingResponseMessage />
        )}

        <div
          className={cn('flex min-w-0 flex-col gap-3', {
            'w-full': message.role === 'assistant' || mode === 'edit',
            'min-h-96': message.role === 'assistant' && requiresScrollPadding,
            'max-w-[70%] sm:max-w-[min(fit-content,80%)]':
              message.role === 'user' && mode !== 'edit',
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              data-testid={`message-attachments`}
              className={cn('flex flex-row justify-end gap-2', {
                'justify-start': message.role === 'assistant',
              })}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  key={attachment.url}
                  attachment={{
                    name: attachment.filename ?? 'file',
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                />
              ))}
            </div>
          )}

          {renderBlocks.map((block) => {
            if (block.kind === 'tool-group') {
              return (
                <MessageToolGroup
                  key={`tool-group-${block.startIndex}`}
                  tools={block.tools}
                  isLoading={isLoading}
                  submitApproval={submitApproval}
                  isSubmitting={isSubmitting}
                  pendingApprovalId={pendingApprovalId}
                />
              );
            }

            const parts = block.parts;
            const index = block.index;
            const [part] = parts;
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === 'reasoning' && part.text?.trim().length > 0) {
              return (
                <MessageReasoning
                  key={key}
                  isLoading={isLoading}
                  reasoning={part.text}
                />
              );
            }

            if (type === 'text') {
              if (isNamePart(part)) {
                return (
                  <Streamdown
                    key={key}
                    className="-mb-2 mt-0 border-l-4 pl-2 text-muted-foreground"
                  >{`# ${formatNamePart(part)}`}</Streamdown>
                );
              }
              if (mode === 'view') {
                return (
                  <div key={key}>
                    <MessageContent
                      data-testid="message-content"
                      className={cn({
                        'bg-secondary w-fit break-words rounded-2xl px-3 py-2 text-left text-base':
                          message.role === 'user',
                        'bg-transparent px-0 py-0 text-left text-base':
                          message.role === 'assistant',
                      })}
                    >
                      <Response>
                        {sanitizeText(joinMessagePartSegments(parts))}
                      </Response>
                    </MessageContent>
                  </div>
                );
              }

              if (mode === 'edit') {
                return (
                  <div
                    key={key}
                    className="flex w-full flex-row items-start gap-3"
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        setMode={setMode}
                        setMessages={setMessages}
                        regenerate={regenerate}
                      />
                    </div>
                  </div>
                );
              }
            }

            // dynamic-tool parts are rendered by MessageToolGroup above.

            // Support for citations/annotations
            if (type === 'source-url') {
              return (
                <a
                  key={key}
                  href={part.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-baseline text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <sup className="text-xs">[{part.title || part.url}]</sup>
                </a>
              );
            }

            // Render OAuth errors inline
            if (type === 'data-error' && isCredentialErrorMessage(part.data)) {
              return (
                <MessageOAuthError
                  key={key}
                  error={part.data}
                  allMessages={allMessages}
                  setMessages={setMessages}
                  sendMessage={sendMessage}
                />
              );
            }
          })}

          {!isReadonly && !hasOnlyErrors && (
            <MessageActions
              key={`action-${message.id}`}
              message={message}
              isLoading={isLoading}
              setMode={setMode}
              errorCount={errorParts.length}
              showErrors={showErrors}
              onToggleErrors={() => setShowErrors(!showErrors)}
              initialFeedback={initialFeedback}
            />
          )}

          {errorParts.length > 0 && (hasOnlyErrors || showErrors) && (
            <div className="flex flex-col gap-2">
              {errorParts.map((part, index) => (
                <MessageError
                  key={`error-${message.id}-${index}`}
                  error={part.data}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    // While streaming, re-render whenever the AI SDK produces a new message
    // object (each throttled update). We use reference equality rather than
    // deep-equal on parts because fast-deep-equal short-circuits on identical
    // references — and the SDK may mutate parts in place during streaming.
    if (nextProps.isLoading && prevProps.message !== nextProps.message)
      return false;

    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding)
      return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
    if (prevProps.initialFeedback?.feedbackType !== nextProps.initialFeedback?.feedbackType)
      return false;

    return true; // Props are equal, skip re-render
  },
);

type ChatPart = ChatMessage['parts'][number];
type ToolPart = Extract<ChatPart, { type: 'dynamic-tool' }>;

type RenderBlock =
  | { kind: 'segment'; parts: ChatPart[]; index: number }
  | { kind: 'tool-group'; tools: ToolPart[]; startIndex: number };

const groupConsecutiveToolSegments = (
  partSegments: ChatPart[][],
): RenderBlock[] => {
  const blocks: RenderBlock[] = [];
  let i = 0;
  while (i < partSegments.length) {
    const segment = partSegments[i];
    const firstPart = segment[0];
    if (firstPart?.type === 'dynamic-tool') {
      const startIndex = i;
      const tools: ToolPart[] = [firstPart as ToolPart];
      i++;
      while (
        i < partSegments.length &&
        partSegments[i][0]?.type === 'dynamic-tool'
      ) {
        tools.push(partSegments[i][0] as ToolPart);
        i++;
      }
      blocks.push({ kind: 'tool-group', tools, startIndex });
    } else {
      blocks.push({ kind: 'segment', parts: segment, index: i });
      i++;
    }
  }
  return blocks;
};

const MessageToolGroup = ({
  tools,
  isLoading,
  submitApproval,
  isSubmitting,
  pendingApprovalId,
}: {
  tools: ToolPart[];
  isLoading: boolean;
  submitApproval: ReturnType<typeof useApproval>['submitApproval'];
  isSubmitting: boolean;
  pendingApprovalId: string | null;
}) => {
  const isMultiple = tools.length > 1;
  return (
    <div
      className={cn('flex flex-col gap-2', {
        'rounded-md border border-border/60 bg-muted/20 p-2': isMultiple,
      })}
      data-testid={isMultiple ? 'tool-group' : undefined}
    >
      {tools.map((tool) => (
        <ToolPartRenderer
          key={tool.toolCallId}
          part={tool}
          isLoading={isLoading}
          submitApproval={submitApproval}
          isSubmitting={isSubmitting}
          pendingApprovalId={pendingApprovalId}
        />
      ))}
    </div>
  );
};

const ToolPartRenderer = ({
  part,
  isLoading,
  submitApproval,
  isSubmitting,
  pendingApprovalId,
}: {
  part: ToolPart;
  isLoading: boolean;
  submitApproval: ReturnType<typeof useApproval>['submitApproval'];
  isSubmitting: boolean;
  pendingApprovalId: string | null;
}) => {
  const { toolCallId, input, state, errorText, output, toolName } = part;

  const isMcpApproval =
    part.callProviderMetadata?.databricks?.approvalRequestId != null;
  const mcpServerName =
    part.callProviderMetadata?.databricks?.mcpServerName?.toString();

  const approved: boolean | undefined =
    'approval' in part ? part.approval?.approved : undefined;

  const effectiveState: ToolState = (() => {
    if (part.providerExecuted && !isLoading && state === 'input-available') {
      return 'output-available';
    }
    return state;
  })();

  if (isMcpApproval) {
    return (
      <McpTool defaultOpen={true}>
        <McpToolHeader
          serverName={mcpServerName}
          toolName={toolName}
          state={effectiveState}
          approved={approved}
        />
        <McpToolContent>
          <McpToolInput input={input} />
          {state === 'approval-requested' && (
            <McpApprovalActions
              onApprove={() =>
                submitApproval({ approvalRequestId: toolCallId, approve: true })
              }
              onDeny={() =>
                submitApproval({
                  approvalRequestId: toolCallId,
                  approve: false,
                })
              }
              isSubmitting={isSubmitting && pendingApprovalId === toolCallId}
            />
          )}
          {state === 'output-available' && output != null && (
            <ToolOutput
              output={
                errorText ? (
                  <div className="rounded border p-2 text-red-500">
                    Error: {errorText}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap font-mono text-sm">
                    {typeof output === 'string'
                      ? output
                      : JSON.stringify(output, null, 2)}
                  </div>
                )
              }
              errorText={undefined}
            />
          )}
        </McpToolContent>
      </McpTool>
    );
  }

  return (
    <Tool key={toolCallId} defaultOpen={true}>
      <ToolHeader type={toolName} state={effectiveState} />
      <ToolContent>
        <ToolInput input={input} />
        {state === 'output-available' && (
          <ToolOutput
            output={
              errorText ? (
                <div className="rounded border p-2 text-red-500">
                  Error: {errorText}
                </div>
              ) : (
                <div className="whitespace-pre-wrap font-mono text-sm">
                  {typeof output === 'string'
                    ? output
                    : JSON.stringify(output, null, 2)}
                </div>
              )
            }
            errorText={undefined}
          />
        )}
      </ToolContent>
    </Tool>
  );
};

export const AwaitingResponseMessage = () => {
  const role = 'assistant';

  return (
    <div
      data-testid="message-assistant-loading"
      className="group/message w-full"
      data-role={role}
    >
      <div className="flex items-start justify-start gap-3">
        <Shimmer className="flex items-center">Generating response</Shimmer>
      </div>
    </div>
  );
};
