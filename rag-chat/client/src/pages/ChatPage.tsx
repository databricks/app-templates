import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Streamdown } from 'streamdown';
import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquarePlus, MessageSquare, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button, ScrollArea, Separator, Textarea } from '@databricks/appkit-ui/react';

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface RagSource {
  index: number;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

function createTransport(chatIdRef: React.RefObject<string | null>) {
  return new DefaultChatTransport({
    api: '/api/chat',
    body: () => (chatIdRef.current ? { chatId: chatIdRef.current } : {}),
    headers: { 'Content-Type': 'application/json' },
  });
}

function SourcesDisplay({ sources }: { sources: RagSource[] }) {
  const [expanded, setExpanded] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border bg-muted/20 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-medium">
          Retrieved context ({sources.length} source{sources.length !== 1 ? 's' : ''})
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t px-3 py-2">
          {sources.map((source) => (
            <div key={source.index} className="rounded border bg-background p-2">
              <div className="mb-1 flex items-center justify-between text-muted-foreground">
                <span className="font-medium">Source {source.index}</span>
                <span>similarity: {(Number(source.similarity) * 100).toFixed(1)}%</span>
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-foreground">{source.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Pull RAG sources out of any `data-sources` part the server attached to this
// assistant message. The server writes it via createUIMessageStream before the
// text tokens, so it's available as soon as the assistant message exists.
function extractSources(message: { parts?: unknown[] }): RagSource[] {
  return (message.parts ?? [])
    .filter((p): p is { type: string; data: RagSource[] } => {
      if (typeof p !== 'object' || p === null) return false;
      const part = p as { type?: unknown };
      return part.type === 'data-sources';
    })
    .flatMap((p) => p.data);
}

export function ChatPage() {
  const [chatId, setChatId] = useState<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const chatLoadTokenRef = useRef(0);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const transportRef = useRef(createTransport(chatIdRef));

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const autosize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  // Radix ScrollArea wraps content in `display: table; min-width: 100%` which
  // grows horizontally past the viewport when children are wide (long chat
  // titles push the sidebar delete button off-screen). Force block layout so
  // children inherit the viewport width and `truncate` can do its job.
  const forceBlockContent = (vp: HTMLDivElement) => {
    const content = vp.firstElementChild as HTMLElement | null;
    if (content) content.style.display = 'block';
  };
  const sidebarScrollAreaRef = useCallback((node: HTMLDivElement | null) => {
    const vp = node?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]') ?? null;
    if (vp) forceBlockContent(vp);
  }, []);
  const scrollAreaRef = useCallback((node: HTMLDivElement | null) => {
    const vp = node?.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]') ?? null;
    viewportRef.current = vp;
    if (!vp) return;
    forceBlockContent(vp);
    vp.addEventListener('scroll', () => {
      const top = vp.scrollTop;
      if (top < lastScrollTopRef.current - 5) stickToBottomRef.current = false;
      if (vp.scrollHeight - top - vp.clientHeight < 20) stickToBottomRef.current = true;
      lastScrollTopRef.current = top;
    });
  }, []);
  const { messages, setMessages, sendMessage, status } = useChat({
    transport: transportRef.current,
  });

  const loadChats = useCallback(async () => {
    const res = await fetch('/api/chats');
    if (res.ok) setChats(await res.json());
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (vp && stickToBottomRef.current) vp.scrollTop = vp.scrollHeight;
  }, [messages]);

  const selectChat = useCallback(
    async (id: string) => {
      const loadToken = ++chatLoadTokenRef.current;
      setChatId(id);
      chatIdRef.current = id;
      setMessages([]);
      const res = await fetch(`/api/chats/${id}/messages`);
      if (!res.ok) return;
      const saved: ChatMessage[] = await res.json();
      if (loadToken !== chatLoadTokenRef.current) return;
      const restored = saved.map((m, i) => ({
        id: m.id || String(i),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        parts: [{ type: 'text' as const, text: m.content }],
        createdAt: new Date(m.created_at),
      }));
      setMessages(restored);
    },
    [setMessages]
  );

  const startNewChat = useCallback(() => {
    chatLoadTokenRef.current += 1;
    setChatId(null);
    chatIdRef.current = null;
    setMessages([]);
  }, [setMessages]);

  const deleteChat = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      if (chatIdRef.current === id) {
        chatLoadTokenRef.current += 1;
        setChatId(null);
        chatIdRef.current = null;
        setMessages([]);
      }
      setChats((prev) => prev.filter((c) => c.id !== id));
    },
    [setMessages]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (status !== 'ready') return;
      const text = input.trim();
      if (!text) return;

      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      inputRef.current?.focus();
      stickToBottomRef.current = true;

      void (async () => {
        if (!chatIdRef.current) {
          const title = text.slice(0, 80);
          const res = await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
          });
          if (!res.ok) return;
          const chat: ChatSession = await res.json();
          setChatId(chat.id);
          chatIdRef.current = chat.id;
        }
        await sendMessage({ text });
        void loadChats();
      })();
    },
    [input, status, sendMessage, setInput, loadChats]
  );

  return (
    <div className="flex h-screen bg-background">
      {sidebarOpen && (
        <div className="flex w-72 flex-col border-r bg-muted/30">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Lakehouse Knowledge Assistant</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask questions about Databricks, Spark, Delta Lake, and the lakehouse.
            </p>
          </div>
          <div className="px-4 pb-3">
            <Button variant="outline" className="w-full justify-start gap-2" onClick={startNewChat}>
              <MessageSquarePlus className="h-4 w-4" />
              New Chat
            </Button>
          </div>
          <Separator />
          <ScrollArea ref={sidebarScrollAreaRef} className="min-h-0 flex-1">
            <div className="space-y-1 p-2">
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`flex items-center gap-1 overflow-hidden rounded-md pr-1 transition-colors ${
                    chatId === chat.id
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <button
                    onClick={() => selectChat(chat.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-left text-sm"
                  >
                    <MessageSquare className="h-4 w-4 shrink-0" />
                    <span className={`truncate ${chatId === chat.id ? 'font-medium' : ''}`}>{chat.title}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete chat"
                    title="Delete chat"
                    className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) void deleteChat(chat.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {chats.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">No previous chats</p>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-muted-foreground"
          >
            {sidebarOpen ? '\u2190' : '\u2192'}
          </Button>
          <h1 className="text-sm font-semibold text-foreground">RAG Chat</h1>
        </header>

        <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-lg font-medium text-foreground">Lakehouse Knowledge Assistant</p>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Ask questions about Databricks, Apache Spark, Delta Lake, and the data lakehouse. Answers are grounded
                  in a curated knowledge base.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </p>
                {message.role === 'assistant' && <SourcesDisplay sources={extractSources(message)} />}
                {message.parts.map((part, index) =>
                  part.type === 'text' ? (
                    message.role === 'assistant' ? (
                      <Streamdown key={`${message.id}-${index}`} animated={false} className="text-sm">
                        {part.text}
                      </Streamdown>
                    ) : (
                      <p key={`${message.id}-${index}`} className="whitespace-pre-wrap text-sm">
                        {part.text}
                      </p>
                    )
                  ) : null
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="border-t p-4">
          <form className="mx-auto flex max-w-3xl items-end gap-2" onSubmit={handleSubmit}>
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autosize();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Ask a question... (Shift+Enter for newline)"
              autoFocus
              rows={1}
              className="max-h-[200px] min-h-[40px] resize-none"
            />
            <Button type="submit" disabled={status !== 'ready' || !input.trim()}>
              {status === 'submitted' || status === 'streaming' ? 'Sending...' : 'Send'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
