import type {
  DataUIPart,
  LanguageModelUsage,
  UIMessage,
  UIMessageChunk,
} from 'ai';
import { useChat } from '@ai-sdk/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import { fetchWithErrorHandlers, generateUUID } from '@/lib/utils';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type {
  Attachment,
  ChatMessage,
  CustomUIDataTypes,
  VisibilityType,
} from '@chat-template/core';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import { useSearchParams } from 'react-router-dom';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { ChatSDKError } from '@chat-template/core/errors';
import { useDataStream } from './data-stream-provider';
import { isCredentialErrorMessage } from '@/lib/oauth-error-utils';
import { ChatTransport, type StreamingPartIds } from '../lib/ChatTransport';
import type { ClientSession } from '@chat-template/auth';
import { softNavigateToChatId } from '@/lib/navigation';
import { useAppConfig } from '@/contexts/AppConfigContext';

/**
 * Merges duplicate parts in a message by combining their content.
 *
 * When a stream is interrupted and resumed with synthetic start events,
 * the AI SDK may create duplicate parts with the same ID. This function
 * merges them by concatenating content from later occurrences into the first.
 *
 * @returns A new parts array with duplicates merged, or the original if no duplicates
 */
function mergeDuplicateParts(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  const seenIds = new Map<string, number>(); // id -> index in result
  const result: UIMessage['parts'] = [];

  for (const part of parts) {
    // Only merge parts that have an 'id' field (reasoning, text, tool-call, etc.)
    const partId = 'id' in part ? (part as { id?: string }).id : undefined;

    if (partId && seenIds.has(partId)) {
      // Duplicate found - merge content into existing part
      const existingIndex = seenIds.get(partId);
      if (existingIndex === undefined) continue;
      const existingPart = result[existingIndex];

      // Merge based on part type
      if (
        existingPart.type === 'reasoning' &&
        part.type === 'reasoning' &&
        'reasoning' in existingPart &&
        'reasoning' in part
      ) {
        // Concatenate reasoning text
        (existingPart as { reasoning: string }).reasoning =
          ((existingPart as { reasoning: string }).reasoning || '') +
          ((part as { reasoning: string }).reasoning || '');
      } else if (
        existingPart.type === 'text' &&
        part.type === 'text' &&
        'text' in existingPart &&
        'text' in part
      ) {
        // Concatenate text
        (existingPart as { text: string }).text =
          ((existingPart as { text: string }).text || '') +
          ((part as { text: string }).text || '');
      }
      // For other types, just keep the first occurrence (don't merge)
    } else {
      // First occurrence - add to result
      if (partId) {
        seenIds.set(partId, result.length);
      }
      result.push(part);
    }
  }

  return result;
}

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  initialLastContext,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: ClientSession;
  initialLastContext?: LanguageModelUsage;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();
  const { chatHistoryEnabled } = useAppConfig();

  const [input, setInput] = useState<string>('');
  const [_usage, setUsage] = useState<LanguageModelUsage | undefined>(
    initialLastContext,
  );

  const [streamCursor, setStreamCursor] = useState(0);
  const streamCursorRef = useRef(streamCursor);
  streamCursorRef.current = streamCursor;
  const [lastPart, setLastPart] = useState<UIMessageChunk | undefined>();
  const lastPartRef = useRef<UIMessageChunk | undefined>(lastPart);
  lastPartRef.current = lastPart;

  // Track IDs of parts that are currently streaming (haven't received end event)
  // Used to restore AI SDK trackers on stream resumption
  const streamingPartIdsRef = useRef<StreamingPartIds>({});

  // Track if we're currently resuming a stream (to know when to merge duplicate parts)
  const isResumingRef = useRef(false);
  // Track if we've already merged duplicates for the current resume (only need to do it once)
  const hasMergedDuringResumeRef = useRef(false);

  // Single counter for resume attempts - reset when stream parts are received
  const resumeAttemptCountRef = useRef(0);
  const maxResumeAttempts = 3;

  const abortController = useRef<AbortController | null>(new AbortController());
  useEffect(() => {
    return () => {
      abortController.current?.abort('ABORT_SIGNAL');
    };
  }, []);

  const fetchWithAbort = useMemo(() => {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      // useChat does not cancel /stream requests when the component is unmounted
      const signal = abortController.current?.signal;
      return fetchWithErrorHandlers(input, { ...init, signal });
    };
  }, []);

  const stop = useCallback(() => {
    abortController.current?.abort('USER_ABORT_SIGNAL');
  }, []);

  const isNewChat = initialMessages.length === 0;
  const didFetchHistoryOnNewChat = useRef(false);
  const fetchChatHistory = useCallback(() => {
    mutate(unstable_serialize(getChatHistoryPaginationKey));
  }, [mutate]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    resumeStream,
    clearError,
    addToolApprovalResponse,
    regenerate,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    resume: id !== undefined && initialMessages.length > 0, // Enable automatic stream resumption
    transport: new ChatTransport({
      onStreamPart: (part) => {
        // As soon as we recive a stream part, we fetch the chat history again for new chats
        if (isNewChat && !didFetchHistoryOnNewChat.current) {
          fetchChatHistory();
          didFetchHistoryOnNewChat.current = true;
        }
        // Reset resume attempts when we successfully receive stream parts
        resumeAttemptCountRef.current = 0;

        // Track streaming part IDs for stream resumption
        // When we receive a start event, store the ID; when we receive end, clear it
        if (part.type === 'reasoning-start') {
          streamingPartIdsRef.current = {
            ...streamingPartIdsRef.current,
            reasoning: part.id,
          };
        } else if (part.type === 'reasoning-end') {
          streamingPartIdsRef.current = {
            ...streamingPartIdsRef.current,
            reasoning: undefined,
          };
        } else if (part.type === 'text-start') {
          streamingPartIdsRef.current = {
            ...streamingPartIdsRef.current,
            text: part.id,
          };
        } else if (part.type === 'text-end') {
          streamingPartIdsRef.current = {
            ...streamingPartIdsRef.current,
            text: undefined,
          };
        } else if (part.type === 'tool-input-start') {
          streamingPartIdsRef.current = {
            ...streamingPartIdsRef.current,
            toolInput: part.id,
          };
        } else if (part.type === 'tool-input-end') {
          streamingPartIdsRef.current = {
            ...streamingPartIdsRef.current,
            toolInput: undefined,
          };
        }

        // Keep track of the number of stream parts received
        setStreamCursor((cursor) => cursor + 1);
        setLastPart(part);
      },
      getStreamingPartIds: () => streamingPartIdsRef.current,
      api: '/api/chat',
      fetch: fetchWithAbort,
      prepareSendMessagesRequest({ messages, id, body }) {
        const lastMessage = messages.at(-1);
        const isUserMessage = lastMessage?.role === 'user';

        // For continuations (non-user messages like tool results), we must always
        // send previousMessages because the tool result only exists client-side
        // and hasn't been saved to the database yet.
        const needsPreviousMessages = !chatHistoryEnabled || !isUserMessage;

        return {
          body: {
            id,
            // Only include message field for user messages (new messages)
            // For continuation (assistant messages with tool results), omit message field
            ...(isUserMessage ? { message: lastMessage } : {}),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            nextMessageId: generateUUID(),
            // Send previous messages when:
            // 1. Database is disabled (ephemeral mode) - always need client-side messages
            // 2. Continuation request (tool results) - tool result only exists client-side
            ...(needsPreviousMessages
              ? {
                  previousMessages: isUserMessage
                    ? messages.slice(0, -1)
                    : messages,
                }
              : {}),
            ...body,
          },
        };
      },
      prepareReconnectToStreamRequest({ id }) {
        return {
          api: `/api/chat/${id}/stream`,
          credentials: 'include',
          headers: {
            // Pass the cursor to the server so it can resume the stream from the correct point
            'X-Resume-Stream-Cursor': streamCursorRef.current.toString(),
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) =>
        ds ? [...ds, dataPart as DataUIPart<CustomUIDataTypes>] : [],
      );
      if (dataPart.type === 'data-usage') {
        setUsage(dataPart.data as LanguageModelUsage);
      }
    },
    onFinish: ({
      isAbort,
      isDisconnect,
      isError,
      messages: finishedMessages,
    }) => {
      // Reset state for next message
      didFetchHistoryOnNewChat.current = false;

      // If user aborted, don't try to resume
      if (isAbort) {
        console.log('[Chat onFinish] Stream was aborted by user, not resuming');
        setStreamCursor(0);
        streamingPartIdsRef.current = {};
        isResumingRef.current = false;
        hasMergedDuringResumeRef.current = false;
        fetchChatHistory();
        return;
      }

      // Check if the last message contains an OAuth credential error
      // If so, don't try to resume - the user needs to authenticate first
      const lastMessage = finishedMessages?.at(-1);
      const hasOAuthError = lastMessage?.parts?.some(
        (part) =>
          part.type === 'data-error' &&
          typeof part.data === 'string' &&
          isCredentialErrorMessage(part.data),
      );

      if (hasOAuthError) {
        console.log(
          '[Chat onFinish] OAuth credential error detected, not resuming',
        );
        setStreamCursor(0);
        streamingPartIdsRef.current = {};
        isResumingRef.current = false;
        hasMergedDuringResumeRef.current = false;
        fetchChatHistory();
        clearError();
        return;
      }

      // Determine if we should attempt to resume:
      // 1. Stream didn't end with a 'finish' part (incomplete)
      // 2. It was a disconnect/error that terminated the stream
      // 3. We haven't exceeded max resume attempts
      const streamIncomplete = lastPartRef.current?.type !== 'finish';
      const shouldResume =
        streamIncomplete &&
        (isDisconnect || isError || lastPartRef.current === undefined);

      if (shouldResume && resumeAttemptCountRef.current < maxResumeAttempts) {
        console.log(
          '[Chat onFinish] Resuming stream. Attempt:',
          resumeAttemptCountRef.current + 1,
        );
        resumeAttemptCountRef.current++;
        isResumingRef.current = true;
        hasMergedDuringResumeRef.current = false;
        resumeStream();
      } else {
        // Stream completed normally or we've exhausted resume attempts
        if (resumeAttemptCountRef.current >= maxResumeAttempts) {
          console.warn('[Chat onFinish] Max resume attempts reached');
        }

        setStreamCursor(0);
        streamingPartIdsRef.current = {};
        isResumingRef.current = false;
        hasMergedDuringResumeRef.current = false;
        fetchChatHistory();
      }
    },
    onError: (error) => {
      console.log('[Chat onError] Error occurred:', error);

      // Only show toast for explicit ChatSDKError (backend validation errors)
      // Other errors (network, schema validation) are handled silently or in message parts
      if (error instanceof ChatSDKError) {
        toast({
          type: 'error',
          description: error.message,
        });
      } else {
        // Non-ChatSDKError: Could be network error or in-stream error
        // Log but don't toast - errors during streaming may be informational
        console.warn('[Chat onError] Error during streaming:', error.message);
      }
      // Note: We don't call resumeStream here because onError can be called
      // while the stream is still active (e.g., for data-error parts).
      // Resume logic is handled exclusively in onFinish.
    },
  });

  // Merge duplicate parts once when resuming a stream
  // This runs after the synthetic start event creates a duplicate, keeping the UI clean
  useEffect(() => {
    if (!isResumingRef.current || hasMergedDuringResumeRef.current) return;

    const lastMessage = messages.at(-1);
    if (lastMessage?.role !== 'assistant' || !lastMessage.parts) return;

    const mergedParts = mergeDuplicateParts(lastMessage.parts);
    if (mergedParts.length !== lastMessage.parts.length) {
      console.log(
        '[Chat] Merging duplicate parts during resume:',
        lastMessage.parts.length,
        '->',
        mergedParts.length,
      );
      hasMergedDuringResumeRef.current = true;
      setMessages(
        messages.map((msg, idx) =>
          idx === messages.length - 1 ? { ...msg, parts: mergedParts } : msg,
        ),
      );
    }
  }, [messages, setMessages]);

  const [searchParams] = useSearchParams();
  const query = searchParams.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: 'user' as const,
        parts: [{ type: 'text', text: query }],
      });

      setHasAppendedQuery(true);
      softNavigateToChatId(id, chatHistoryEnabled);
    }
  }, [query, sendMessage, hasAppendedQuery, id, chatHistoryEnabled]);

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader />

        <Messages
          chatId={id}
          status={status}
          messages={messages}
          setMessages={setMessages}
          addToolApprovalResponse={addToolApprovalResponse}
          regenerate={regenerate}
          sendMessage={sendMessage}
          isReadonly={isReadonly}
          selectedModelId={initialChatModel}
        />

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            <MultimodalInput
              chatId={id}
              input={input}
              setInput={setInput}
              status={status}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              sendMessage={sendMessage}
              selectedVisibilityType={visibilityType}
            />
          )}
        </div>
      </div>
    </>
  );
}
