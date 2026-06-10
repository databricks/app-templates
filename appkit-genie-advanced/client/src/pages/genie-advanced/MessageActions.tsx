import { useState } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import { ThumbsUp, ThumbsDown, Download, Loader2 } from 'lucide-react';
import type { GenieMessageItem } from '@databricks/appkit-ui/react';
import { sendFeedback, statementResponseToCsv } from './api';
import type { FeedbackRating } from './types';

interface Props {
  alias: string;
  conversationId: string | null;
  message: GenieMessageItem;
}

export function MessageActions({ alias, conversationId, message }: Props) {
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [submitting, setSubmitting] = useState<FeedbackRating | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryAttachment = message.attachments.find(
    (a) => a.query !== undefined && a.attachmentId !== undefined,
  );
  const queryResult =
    queryAttachment?.attachmentId
      ? message.queryResults.get(queryAttachment.attachmentId)
      : undefined;

  const handleFeedback = async (next: FeedbackRating) => {
    if (!conversationId) return;
    setSubmitting(next);
    setError(null);
    try {
      await sendFeedback(alias, conversationId, message.id, next);
      setRating(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  };

  const handleDownload = () => {
    if (!queryResult) return;
    const csv = statementResponseToCsv(queryResult);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `genie-${message.id.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (message.role !== 'assistant' || message.status !== 'COMPLETED') {
    return null;
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      <Button
        variant={rating === 'POSITIVE' ? 'default' : 'ghost'}
        size="sm"
        className="h-6 px-2"
        onClick={() => void handleFeedback('POSITIVE')}
        disabled={submitting !== null || !conversationId}
        aria-label="Mark response helpful"
      >
        {submitting === 'POSITIVE' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ThumbsUp className="h-3 w-3" />
        )}
      </Button>
      <Button
        variant={rating === 'NEGATIVE' ? 'default' : 'ghost'}
        size="sm"
        className="h-6 px-2"
        onClick={() => void handleFeedback('NEGATIVE')}
        disabled={submitting !== null || !conversationId}
        aria-label="Mark response unhelpful"
      >
        {submitting === 'NEGATIVE' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ThumbsDown className="h-3 w-3" />
        )}
      </Button>
      {queryResult && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={handleDownload}
          aria-label="Download query results as CSV"
        >
          <Download className="h-3 w-3" />
          CSV
        </Button>
      )}
      {error && (
        <span className="text-[10px] text-destructive ml-1">{error}</span>
      )}
    </div>
  );
}
