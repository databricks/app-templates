import { PreviewMessage, AwaitingResponseMessage } from './message';
import { memo, useEffect } from 'react';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { useMessages } from '@/hooks/use-messages';
import type { ChatMessage, FeedbackMap } from '@chat-template/core';
import { useDataStream } from './data-stream-provider';
import { Conversation, ConversationContent } from './elements/conversation';
import { ArrowDownIcon } from 'lucide-react';

interface MessagesProps {
  status: UseChatHelpers<ChatMessage>['status'];
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>['addToolApprovalResponse'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  selectedModelId: string;
  feedback?: FeedbackMap;
  // Durable-resume: messageId -> chars of text that belonged to attempt 1.
  // When present, slice that many chars off the front of the message's text
  // parts at render time so only attempt-2 content shows. State itself is
  // left alone because the AI SDK accumulator keeps restoring the full
  // text via structuredClone on every write().
  attempt1TextLen?: Record<string, number>;
}

function PureMessages({
  status,
  messages,
  setMessages,
  addToolApprovalResponse,
  sendMessage,
  regenerate,
  isReadonly,
  selectedModelId,
  feedback = {},
  attempt1TextLen,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  } = useMessages({
    status,
  });

  useDataStream();

  useEffect(() => {
    if (status === 'submitted') {
      requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth',
          });
        }
      });
    }
  }, [status, messagesContainerRef]);

  return (
    <div
      ref={messagesContainerRef}
      className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll"
      style={{ overflowAnchor: 'none' }}
    >
      <Conversation className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 md:gap-6">
        <ConversationContent className="flex flex-col gap-4 px-4 py-4 md:gap-6">
          {messages.map((message, index) => {
            // Render-time durable-resume slice: if this message had a resume
            // boundary recorded, remove the leading attempt-1 chars from its
            // text parts before passing to PreviewMessage. Creates a new
            // message object so the memo sees a reference change and
            // re-renders. Tool / step / data parts are passed through.
            let displayMessage = message;
            const drop = attempt1TextLen?.[message.id];
            if (drop && drop > 0) {
              let remaining = drop;
              const newParts = (message.parts ?? []).map((p) => {
                const tp = p as { type?: string; text?: string };
                if (tp.type !== 'text' || !tp.text || remaining <= 0) return p;
                const cut = Math.min(remaining, tp.text.length);
                remaining -= cut;
                return { ...tp, text: tp.text.slice(cut) };
              });
              displayMessage = { ...message, parts: newParts } as ChatMessage;
            }
            return (
              <PreviewMessage
                key={message.id}
                message={displayMessage}
                allMessages={messages}
                isLoading={
                  status === 'streaming' && messages.length - 1 === index
                }
                setMessages={setMessages}
                addToolApprovalResponse={addToolApprovalResponse}
                sendMessage={sendMessage}
                regenerate={regenerate}
                isReadonly={isReadonly}
                requiresScrollPadding={
                  hasSentMessage && index === messages.length - 1
                }
                initialFeedback={feedback[message.id]}
              />
            );
          })}

          {status === 'submitted' &&
            messages.length > 0 &&
            messages[messages.length - 1].role === 'user' &&
            selectedModelId !== 'chat-model-reasoning' && (
              <AwaitingResponseMessage />
            )}

          <div
            ref={messagesEndRef}
            className="min-h-[24px] min-w-[24px] shrink-0"
          />
        </ConversationContent>
      </Conversation>

      {!isAtBottom && (
        <button
          className="-translate-x-1/2 absolute bottom-40 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-colors hover:bg-muted"
          onClick={() => scrollToBottom('smooth')}
          type="button"
          aria-label="Scroll to bottom"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  // Always re-render during streaming to ensure incremental token display
  if (prevProps.status === 'streaming' || nextProps.status === 'streaming') {
    return false;
  }

  if (prevProps.selectedModelId !== nextProps.selectedModelId) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  if (!equal(prevProps.feedback, nextProps.feedback)) return false;

  return true; // Props are equal, skip re-render
});
