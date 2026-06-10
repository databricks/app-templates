import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Card,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  GenieChatInput,
  GenieChatMessage,
  GenieQueryVisualization,
  Spinner,
  useGenieChat,
} from '@databricks/appkit-ui/react';
import { AlertCircle, MessageSquareDashed } from 'lucide-react';
import { SpacePicker } from './SpacePicker';
import { ConversationList } from './ConversationList';
import { MessageActions } from './MessageActions';
import { MessageProgress } from './MessageProgress';
import { listConversations, listSpaces } from './api';
import type { ConversationSummary, SpaceInfo } from './types';

export function GenieAdvancedPage() {
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const activeConversationId = searchParams.get('conversationId');

  const refreshSpaces = useCallback(async () => {
    setSpacesLoading(true);
    setSpacesError(null);
    try {
      const result = await listSpaces();
      setSpaces(result);
      setSelectedAlias((current) => {
        if (current && result.some((s) => s.alias === current && s.accessible)) {
          return current;
        }
        return result.find((s) => s.accessible)?.alias ?? null;
      });
    } catch (err) {
      setSpacesError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpacesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSpaces();
  }, [refreshSpaces]);

  return (
    <div className="h-full flex">
      <aside className="w-72 border-r bg-muted/30 flex flex-col shrink-0 min-h-0">
        <div className="p-4 border-b shrink-0">
          <SpacePicker
            spaces={spaces}
            selectedAlias={selectedAlias}
            onSelect={setSelectedAlias}
            onRefresh={() => void refreshSpaces()}
            loading={spacesLoading}
          />
        </div>
        {selectedAlias ? (
          <ConversationsForSpace alias={selectedAlias} />
        ) : (
          <p className="text-xs text-muted-foreground italic p-4">
            Pick a space to see conversations.
          </p>
        )}
      </aside>

      <section className="flex-1 min-w-0 flex flex-col">
        {spacesError && (
          <Alert variant="destructive" className="m-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Could not load spaces</AlertTitle>
            <AlertDescription>{spacesError}</AlertDescription>
          </Alert>
        )}
        {!selectedAlias && !spacesLoading && !spacesError && (
          <NoSpaceState />
        )}
        {selectedAlias && (
          <ChatPane
            key={`${selectedAlias}::${activeConversationId ?? 'new'}`}
            alias={selectedAlias}
          />
        )}
      </section>
    </div>
  );
}

function ConversationsForSpace({ alias }: { alias: string }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeConversationId = searchParams.get('conversationId');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listConversations(alias);
      setConversations(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [alias]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSelect = (conversationId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('conversationId', conversationId);
    setSearchParams(next);
  };

  const handleNew = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('conversationId');
    setSearchParams(next);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 pt-3">
      <ConversationList
        conversations={conversations}
        activeConversationId={activeConversationId}
        loading={loading}
        onSelect={handleSelect}
        onNew={handleNew}
        onRefresh={() => void refresh()}
      />
      {error && (
        <p className="text-[10px] text-destructive mt-2">{error}</p>
      )}
    </div>
  );
}

function ChatPane({ alias }: { alias: string }) {
  const chat = useGenieChat({ alias });
  const messageElements = useMemo(
    () =>
      chat.messages.map((message) => {
        // While an assistant message is in flight (no content yet), AppKit's
        // <GenieChatMessage> renders an empty bubble next to the avatar — show
        // the progress checklist instead until content streams in.
        const isStreamingEmpty =
          message.role === 'assistant' &&
          !message.content &&
          !message.error;
        return (
          <div key={message.id} className="space-y-2">
            {isStreamingEmpty ? (
              <StreamingPlaceholder status={message.status} />
            ) : (
              <GenieChatMessage message={message} />
            )}
            {message.role === 'assistant' && !isStreamingEmpty && (
              <div className="ml-10">
                <MessageProgress status={message.status} />
              </div>
            )}
            {message.attachments.map((attachment) => {
              if (!attachment.attachmentId) return null;
              const queryResult = message.queryResults.get(
                attachment.attachmentId,
              );
              if (!queryResult || !attachment.query) return null;
              return (
                <div
                  key={attachment.attachmentId}
                  className="ml-10 max-w-[calc(100%-2.5rem)]"
                >
                  <Card className="p-3">
                    <GenieQueryVisualization data={queryResult} />
                  </Card>
                </div>
              );
            })}
            <div className="ml-10">
              <MessageActions
                alias={alias}
                conversationId={chat.conversationId}
                message={message}
              />
            </div>
          </div>
        );
      }),
    [chat.messages, chat.conversationId, alias],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Genie Advanced</h2>
          <p className="text-xs text-muted-foreground">
            {chat.conversationId
              ? `Conversation ${chat.conversationId.slice(0, 8)}…`
              : 'New conversation'}
          </p>
        </div>
        {chat.status === 'streaming' && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="h-3 w-3" />
            Streaming…
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {chat.status === 'loading-history' && (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        )}
        {chat.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Chat error</AlertTitle>
            <AlertDescription>{chat.error}</AlertDescription>
          </Alert>
        )}
        {chat.messages.length === 0 && chat.status === 'idle' && (
          <EmptyChat />
        )}
        {messageElements}
      </div>

      <div className="border-t p-4">
        <GenieChatInput
          onSend={chat.sendMessage}
          disabled={chat.status === 'streaming'}
          placeholder="Ask a question about your data…"
        />
      </div>
    </div>
  );
}

function StreamingPlaceholder({ status }: { status: string }) {
  return (
    <div className="flex gap-3">
      <Avatar className="h-8 w-8 shrink-0 mt-1">
        <AvatarFallback className="text-xs font-medium bg-muted">
          AI
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 pt-2">
        <MessageProgress status={status} />
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <Empty>
      <EmptyHeader>
        <MessageSquareDashed className="h-8 w-8 text-muted-foreground" />
      </EmptyHeader>
      <EmptyTitle>Ask Genie a question</EmptyTitle>
      <EmptyDescription>
        Try: &ldquo;How many orders did we have last month?&rdquo;
      </EmptyDescription>
    </Empty>
  );
}

function NoSpaceState() {
  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <Empty>
        <EmptyHeader>
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
        </EmptyHeader>
        <EmptyTitle>No accessible spaces</EmptyTitle>
        <EmptyDescription>
          Configure GENIE_SPACES or DATABRICKS_GENIE_SPACE_ID and reload.
        </EmptyDescription>
      </Empty>
    </div>
  );
}
