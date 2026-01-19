import { useCopyToClipboard } from 'usehooks-ts';

import { Actions, Action } from './elements/actions';
import { memo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import type { ChatMessage } from '@chat-template/core';
import {
  ChevronDown,
  ChevronUp,
  CopyIcon,
  PencilLineIcon,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';

function PureMessageActions({
  message,
  chatId,
  isLoading,
  setMode,
  errorCount = 0,
  showErrors = false,
  onToggleErrors,
}: {
  message: ChatMessage;
  chatId: string;
  isLoading: boolean;
  setMode?: (mode: 'view' | 'edit') => void;
  errorCount?: number;
  showErrors?: boolean;
  onToggleErrors?: () => void;
}) {
  const [_, copyToClipboard] = useCopyToClipboard();
  const [feedback, setFeedback] = useState<'thumbs_up' | 'thumbs_down' | null>(
    null,
  );
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  if (isLoading) return null;

  const textFromParts = message.parts
    ?.filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  const handleCopy = async () => {
    if (!textFromParts) {
      toast.error("There's no text to copy!");
      return;
    }

    await copyToClipboard(textFromParts);
    toast.success('Copied to clipboard!');
  };

  const handleFeedback = useCallback(
    async (feedbackType: 'thumbs_up' | 'thumbs_down') => {
      if (isSubmittingFeedback) return;

      setIsSubmittingFeedback(true);

      try {
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messageId: message.id,
            chatId,
            feedbackType,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to submit feedback');
        }

        setFeedback(feedbackType);
        toast.success(
          feedbackType === 'thumbs_up'
            ? 'Thanks for the positive feedback!'
            : 'Thanks for the feedback!',
        );
      } catch (error) {
        console.error('Error submitting feedback:', error);
        toast.error('Failed to submit feedback. Please try again.');
      } finally {
        setIsSubmittingFeedback(false);
      }
    },
    [message.id, chatId, isSubmittingFeedback],
  );

  // User messages get edit (on hover) and copy actions
  if (message.role === 'user') {
    return (
      <Actions className="-mr-0.5 justify-end">
        <div className="relative">
          {setMode && (
            <Action
              tooltip="Edit"
              onClick={() => setMode('edit')}
              className="-left-10 absolute top-0 opacity-0 transition-opacity group-hover/message:opacity-100"
              data-testid="message-edit-button"
            >
              <PencilLineIcon />
            </Action>
          )}
          <Action tooltip="Copy" onClick={handleCopy}>
            <CopyIcon />
          </Action>
        </div>
      </Actions>
    );
  }

  return (
    <Actions className="-ml-0.5">
      {textFromParts && (
        <Action tooltip="Copy" onClick={handleCopy}>
          <CopyIcon />
        </Action>
      )}
      <Action
        tooltip="Thumbs up"
        onClick={() => handleFeedback('thumbs_up')}
        className={feedback === 'thumbs_up' ? 'text-green-600' : ''}
        data-testid="thumbs-up-button"
      >
        <ThumbsUp />
      </Action>
      <Action
        tooltip="Thumbs down"
        onClick={() => handleFeedback('thumbs_down')}
        className={feedback === 'thumbs_down' ? 'text-red-600' : ''}
        data-testid="thumbs-down-button"
      >
        <ThumbsDown />
      </Action>
      {errorCount > 0 && onToggleErrors && (
        <Action
          tooltip={showErrors ? 'Hide errors' : 'Show errors'}
          onClick={onToggleErrors}
          iconOnly={false}
        >
          <div className="flex items-center gap-1.5">
            {showErrors ? <ChevronUp /> : <ChevronDown />}
            <span className="text-xs">
              {errorCount} {errorCount === 1 ? 'error' : 'errors'}
            </span>
          </div>
        </Action>
      )}
    </Actions>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.errorCount !== nextProps.errorCount) return false;
    if (prevProps.showErrors !== nextProps.showErrors) return false;

    return true;
  },
);
