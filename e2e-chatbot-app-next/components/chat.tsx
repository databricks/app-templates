'use client';

import type { LanguageModelUsage, UIMessageChunk } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import { fetchWithErrorHandlers, generateUUID } from '@/lib/utils';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import type { AuthSession } from '@/databricks/auth/databricks-auth';
import { useSearchParams } from 'next/navigation';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { ChatSDKError } from '@/lib/errors';
import type { Attachment, ChatMessage } from '@/lib/types';
import { useDataStream } from './data-stream-provider';
import { ExtendedDefaultChatTransport } from '@/databricks/utils/databricks-chat-transport';

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
  session: AuthSession;
  initialLastContext?: LanguageModelUsage;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const { setDataStream } = useDataStream();

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

  const onErrorResumeCountRef = useRef(0);
  const onFinishResumeCountRef = useRef(0);
  const maxResumeAttempts = 3;

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    resume: id !== undefined && initialMessages.length > 0, // Enable automatic stream resumption
    transport: new ExtendedDefaultChatTransport({
      onStreamPart: (part) => {
        // when we receive a stream part, we reset the onErrorResumeCountRef and onFinishResumeCountRef
        onErrorResumeCountRef.current = 0;
        onFinishResumeCountRef.current = 0;

        // Keep track of the number of stream parts received
        setStreamCursor((cursor) => cursor + 1);
        setLastPart(part);
      },
      api: '/api/chat',
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        console.log('[Chat prepareSendMessagesRequest] messages', messages);
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: initialChatModel,
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
      prepareReconnectToStreamRequest({ id }) {
        console.log(
          '[Chat prepareReconnectToStreamRequest] cursor',
          streamCursorRef.current,
        );
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
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      if (dataPart.type === 'data-usage') {
        setUsage(dataPart.data);
      }
    },
    onFinish: () => {
      console.log('[Chat onFinish] lastPart received was', lastPartRef.current);
      if (
        lastPartRef.current?.type !== 'finish' &&
        onFinishResumeCountRef.current < maxResumeAttempts
      ) {
        console.log(
          '[Chat onFinish] resuming stream. Attempt:',
          onFinishResumeCountRef.current,
        );
        // If the message is empty attempt to resume the stream.
        onFinishResumeCountRef.current++;
        resumeStream();
      } else {
        setStreamCursor(0);
      }
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      console.log('[Chat onError] Error occurred:', error);

      // For now, just log network errors but don't try to resume
      // The resumeStream() API is designed for page reloads, not mid-stream reconnections
      // Mid-stream reconnections cause duplicate messages because all chunks are replayed
      if (error instanceof ChatSDKError) {
        toast({
          type: 'error',
          description: error.message,
        });
      } else {
        // Network error - the backend will continue streaming and save the full response
        console.warn(
          '[Chat onError] Network error during streaming. Backend will complete the response.',
        );
      }
      if (onErrorResumeCountRef.current < maxResumeAttempts) {
        console.log(
          '[Chat onError] resuming stream. Attempt:',
          onErrorResumeCountRef.current,
        );
        onErrorResumeCountRef.current++;
        resumeStream();
      }
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams?.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: 'user' as const,
        parts: [{ type: 'text', text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, '', `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

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
          regenerate={regenerate}
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
