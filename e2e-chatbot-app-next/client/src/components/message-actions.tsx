import { useCopyToClipboard } from 'usehooks-ts';

import { Actions, Action } from './elements/actions';
import { memo } from 'react';
import { toast } from 'sonner';
import type { ChatMessage } from '@/lib/types';
import { ChevronDown, ChevronUp, CopyIcon, PencilLineIcon } from 'lucide-react';

function PureMessageActions({
  message,
  isLoading,
  setMode,
  errorCount = 0,
  showErrors = false,
  onToggleErrors,
}: {
  message: ChatMessage;
  isLoading: boolean;
  setMode?: (mode: 'view' | 'edit') => void;
  errorCount?: number;
  showErrors?: boolean;
  onToggleErrors?: () => void;
}) {
  const [_, copyToClipboard] = useCopyToClipboard();

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
