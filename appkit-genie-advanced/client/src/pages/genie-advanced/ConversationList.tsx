import { Button, ScrollArea } from '@databricks/appkit-ui/react';
import { MessageSquare, Plus, RefreshCw } from 'lucide-react';
import type { ConversationSummary } from './types';

interface Props {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  loading: boolean;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
}

export function ConversationList({
  conversations,
  activeConversationId,
  loading,
  onSelect,
  onNew,
  onRefresh,
}: Props) {
  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Conversations
        </label>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-6 px-2"
            aria-label="Refresh conversations"
          >
            <RefreshCw
              className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onNew}
            className="h-6 px-2"
            aria-label="Start new conversation"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 -mx-1 px-1">
        {conversations.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground italic px-2 py-4">
            No conversations yet. Ask a question to start one.
          </p>
        )}
        <ul className="space-y-1">
          {conversations.map((c) => {
            const isActive = c.conversation_id === activeConversationId;
            return (
              <li key={c.conversation_id}>
                <button
                  onClick={() => onSelect(c.conversation_id)}
                  className={`w-full text-left rounded-md px-2 py-2 text-xs transition-colors flex items-start gap-2 ${
                    isActive
                      ? 'bg-primary/10 text-foreground'
                      : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">
                      {c.title || 'Untitled conversation'}
                    </p>
                    {c.last_updated_timestamp && (
                      <p className="text-[10px] text-muted-foreground">
                        {formatTimestamp(c.last_updated_timestamp)}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 1) {
    const minutes = Math.floor(diffMs / (1000 * 60));
    return `${minutes}m ago`;
  }
  if (diffHours < 24) {
    return `${Math.floor(diffHours)}h ago`;
  }
  if (diffHours < 24 * 7) {
    return `${Math.floor(diffHours / 24)}d ago`;
  }
  return date.toLocaleDateString();
}
