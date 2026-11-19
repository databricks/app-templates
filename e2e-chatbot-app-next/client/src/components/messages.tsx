import { PreviewMessage, AwaitingResponseMessage } from './message';
import { memo, useEffect } from 'react';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { useMessages } from '@/hooks/use-messages';
import type { ChatMessage, FeedbackMap } from '@databricks/chatbot-core';
import { useDataStream } from './data-stream-provider';
import { Conversation, ConversationContent } from './elements/conversation';
import { ArrowDownIcon } from 'lucide-react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

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
}

/**
 * Scroll behaviour for the conversation, using use-stick-to-bottom's own state:
 * follow a reply while it streams (the library stops following once the user
 * scrolls up), jump to the bottom when a message is sent, and offer a button to
 * get back to the bottom.
 */
function ScrollControls({
  status,
}: {
  status: UseChatHelpers<ChatMessage>['status'];
}) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  useEffect(() => {
    if (status === 'submitted') {
      scrollToBottom('smooth');
    }
  }, [status, scrollToBottom]);

  if (isAtBottom) return null;
  return (
    <button
      className="-translate-x-1/2 absolute bottom-4 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-colors hover:bg-muted"
      onClick={() => scrollToBottom('smooth')}
      type="button"
      aria-label="Scroll to bottom"
      data-testid="scroll-to-bottom-button"
    >
      <ArrowDownIcon className="size-4" />
    </button>
  );
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
}: MessagesProps) {
  const { hasSentMessage } = useMessages({ status });

  useDataStream();

  return (
    <Conversation>
      <ConversationContent className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 px-4 py-4 md:gap-6">
        {messages.map((message, index) => (
          <PreviewMessage
            key={message.id}
            message={message}
            allMessages={messages}
            isLoading={status === 'streaming' && messages.length - 1 === index}
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
        ))}

        {status === 'submitted' &&
          messages.length > 0 &&
          messages[messages.length - 1].role === 'user' &&
          selectedModelId !== 'chat-model-reasoning' && (
            <AwaitingResponseMessage />
          )}

        <div className="min-h-[24px] min-w-[24px] shrink-0" />
      </ConversationContent>

      <ScrollControls status={status} />
    </Conversation>
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
