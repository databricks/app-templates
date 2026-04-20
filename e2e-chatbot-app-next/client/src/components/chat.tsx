import type { DataUIPart, LanguageModelUsage, UIMessageChunk } from 'ai';
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
  FeedbackMap,
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
import { ChatTransport } from '../lib/ChatTransport';
import type { ClientSession } from '@chat-template/auth';
import { softNavigateToChatId } from '@/lib/navigation';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { Greeting } from './greeting';

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  initialLastContext,
  feedback = {},
  title,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: ClientSession;
  initialLastContext?: LanguageModelUsage;
  feedback?: FeedbackMap;
  title?: string;
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

  const [lastPart, setLastPart] = useState<UIMessageChunk | undefined>();
  const lastPartRef = useRef<UIMessageChunk | undefined>(lastPart);
  lastPartRef.current = lastPart;

  // Single counter for resume attempts - reset when stream parts are received
  const resumeAttemptCountRef = useRef(0);
  const maxResumeAttempts = 3;

  // Durable-resume snapshot: on data-resumed we record the length of the
  // assistant message's text at that instant. Used two ways:
  //   (1) at RENDER time, Messages slices the first N chars off the text
  //       parts of the active assistant message so mid-stream the UI shows
  //       only attempt-2 content (state stays as AI SDK writes it).
  //   (2) onFinish runs a final setMessages truncate so the persisted
  //       message also reflects only attempt 2 (would otherwise be saved
  //       with both attempts concatenated).
  // Needs to be state (not ref) so the map-time slice in Messages re-runs
  // when the snapshot changes. Keyed by message id for multi-turn safety.
  const [attempt1TextLen, setAttempt1TextLen] = useState<
    Record<string, number>
  >({});

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

  // For new chats, the title arrives via a `data-title` stream part
  // once backend title generation completes — no separate fetch needed.
  const [streamTitle, setStreamTitle] = useState<string | undefined>();
  const [titlePending, setTitlePending] = useState(false);
  const displayTitle = title ?? streamTitle;

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
        if (isNewChat && !didFetchHistoryOnNewChat.current) {
          fetchChatHistory();
          if (chatHistoryEnabled) {
            setTitlePending(true);
          }
          didFetchHistoryOnNewChat.current = true;
        }
        // Reset resume attempts when we successfully receive stream parts
        resumeAttemptCountRef.current = 0;
        setLastPart(part);
      },
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
      if (dataPart.type === 'data-title') {
        setStreamTitle(dataPart.data as string);
        setTitlePending(false);
        fetchChatHistory();
      }
      // Durable-resume visual reset: when the backend's LongRunningAgentServer
      // emits response.resumed (mid-stream pod crash + reclaim), the chat route
      // writes a data-resumed part to signal us. Drop any text parts we've
      // accumulated from the interrupted attempt so only the new attempt's
      // text renders in-place. Tool parts are kept because they naturally
      // de-dup across attempts via call_id.
      if (dataPart.type === 'data-resumed') {
        // Snapshot the current text length across text parts of the last
        // assistant message. Messages uses this to slice at render time.
        // Mid-stream state mutation is fighting the AI SDK accumulator
        // (replaceMessage structuredClones the message on every write()),
        // so we transform at the view layer instead.
        const lastAssistantId = (() => {
          // Peek into current messages via functional setter without mutating.
          let captured: { id: string; len: number } | null = null;
          setMessages((prev) => {
            if (prev.length) {
              const last = prev[prev.length - 1];
              if (last.role === 'assistant') {
                const currentLen = (last.parts ?? []).reduce(
                  (acc: number, p: { type?: string; text?: string }) =>
                    p.type === 'text' ? acc + (p.text?.length ?? 0) : acc,
                  0,
                );
                captured = { id: last.id, len: currentLen };
              }
            }
            return prev;
          });
          return captured;
        })();
        if (lastAssistantId) {
          const { id, len } = lastAssistantId as { id: string; len: number };
          setAttempt1TextLen((prev) => ({ ...prev, [id]: len }));
        }
      }
    },
    onFinish: ({
      isAbort,
      isDisconnect,
      isError,
      messages: finishedMessages,
    }) => {
      didFetchHistoryOnNewChat.current = false;
      setTitlePending(false);

      // Post-stream durable-resume truncation. Persists attempt-2-only text
      // into useChat's messages state (what gets saved to DB). The render-
      // time slice in Messages handles mid-stream; this handles the final
      // committed state.
      const lastAssistant = finishedMessages?.at(-1);
      if (lastAssistant && lastAssistant.role === 'assistant') {
        const drop = attempt1TextLen[lastAssistant.id];
        if (drop && drop > 0) {
          setMessages((prev) => {
            if (!prev.length) return prev;
            const last = prev[prev.length - 1];
            if (last.id !== lastAssistant.id) return prev;
            let remaining = drop;
            const newParts = (last.parts ?? []).map((p) => {
              const tp = p as { type?: string; text?: string };
              if (tp.type !== 'text' || !tp.text) return p;
              if (remaining <= 0) return p;
              const cut = Math.min(remaining, tp.text.length);
              const nextText = tp.text.slice(cut);
              remaining -= cut;
              return { ...tp, text: nextText };
            });
            const newLast = { ...last, parts: newParts } as ChatMessage;
            return [...prev.slice(0, -1), newLast];
          });
          // Clear so the render-time slice in Messages stops kicking in
          // (state is now already truncated).
          setAttempt1TextLen((prev) => {
            const { [lastAssistant.id]: _omit, ...rest } = prev;
            return rest;
          });
        }
      }

      // If user aborted, don't try to resume
      if (isAbort) {
        console.log('[Chat onFinish] Stream was aborted by user, not resuming');
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
        // Ref: https://github.com/vercel/ai/issues/8477#issuecomment-3603209884
        queueMicrotask(() => {
          resumeStream();
        })
      } else {
        // Stream completed normally or we've exhausted resume attempts
        if (resumeAttemptCountRef.current >= maxResumeAttempts) {
          console.warn('[Chat onFinish] Max resume attempts reached');
        }
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

  const inputElement = <MultimodalInput
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

  if (messages.length === 0) {
    return (
      <div className="flex h-dvh min-w-0 flex-col bg-background">
        <ChatHeader empty />
        <div className="flex min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y p-4">
          <div className="m-auto flex w-full max-w-4xl flex-col">
            <Greeting />
            {inputElement}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader title={displayTitle} isLoadingTitle={titlePending && !displayTitle} />

        <Messages
          status={status}
          messages={messages}
          setMessages={setMessages}
          addToolApprovalResponse={addToolApprovalResponse}
          regenerate={regenerate}
          sendMessage={sendMessage}
          isReadonly={isReadonly}
          selectedModelId={initialChatModel}
          feedback={feedback}
          attempt1TextLen={attempt1TextLen}
        />



        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            inputElement
          )}
        </div>
      </div>
    </>
  );
}
