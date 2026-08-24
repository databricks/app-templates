import { useEffect, useRef, useState } from 'react';
import {
  type AgentChatEvent,
  Button,
  Card,
  CardContent,
  Input,
  useAgentChat,
  usePluginClientConfig,
} from '@databricks/appkit-ui/react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
}

/**
 * Shape of the agents plugin's `clientConfig()` payload — exposed by
 * the agents plugin at server startup and inlined into the boot HTML
 * via `<script id="__appkit__">`. Read with `usePluginClientConfig` so
 * the page doesn't need a separate `GET /api/agents/info` round-trip.
 */
interface AgentsClientConfig {
  agents: string[];
  defaultAgent: string | null;
}

/**
 * Minimal chat surface for the `agents` plugin.
 *
 * The template ships a single coordinator agent and uses the agents
 * plugin's sub-agent feature to compose two authoring forms behind it:
 *
 *   - `planner` (markdown, `config/agents/planner/agent.md`) is the
 *     user-facing chat: pure prose, no tools, opinionated planning
 *     prompt. Declares `agents: [helper]` in its frontmatter so it
 *     can delegate computational actions.
 *   - `helper` (code, `server/agents/helper.ts`) holds the tools
 *     (`current_time`, `count_words`). It's reachable from planner as
 *     the `agent-helper` tool; planner calls it when the user
 *     explicitly asks for a side-effecty action.
 *
 * The page renders one chat against the default agent (planner). To
 * show a picker, drop in more registered top-level agents and add a
 * tab list reading from `agents` below. Today's two-agents-one-tab
 * shape is deliberate: it demonstrates the dual-form composition
 * pattern without confusing scaffolded users with redundant tabs.
 */
export function AgentChat() {
  // Agent registry comes from the agents plugin's `clientConfig()` payload
  // (boot-time, no fetch). `defaultAgent` is null only when no agents are
  // registered; both `planner` and `helper` are registered here.
  const { agents, defaultAgent } =
    usePluginClientConfig<AgentsClientConfig>('agents');
  const activeAgent = defaultAgent ?? agents[0] ?? null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(
    null,
  );
  const [mlflowTraceId, setMlflowTraceId] = useState<string | null>(null);
  const [mlflowTraceUrl, setMlflowTraceUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Surface tool-call events as inline messages. Sub-agent delegations
  // show up here as `agent-helper` tool calls — same wire shape as a
  // function tool, so the same row renders both.
  const handleEvent = (event: AgentChatEvent) => {
    if (event.type === 'appkit.metadata') {
      const traceId = event.data?.traceId;
      const traceUrl = event.data?.traceUrl;
      if (typeof traceId === 'string') setMlflowTraceId(traceId);
      if (typeof traceUrl === 'string') setMlflowTraceUrl(traceUrl);
    }
    if (
      event.type === 'response.output_item.added' &&
      event.item?.type === 'function_call' &&
      event.item.name
    ) {
      setMessages((prev) => [
        ...prev,
        {
          id: `t-${Date.now()}-${Math.random()}`,
          role: 'tool',
          toolName: event.item?.name,
          content: event.item?.arguments ?? '',
        },
      ]);
    }
  };

  const { content, isStreaming, error, send } = useAgentChat({
    agent: activeAgent ?? '',
    onEvent: handleEvent,
  });

  // Mirror the streaming `content` into the pending assistant message so
  // tool-call rows interleave correctly with deltas.
  useEffect(() => {
    if (!pendingAssistantId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === pendingAssistantId ? { ...m, content } : m,
      ),
    );
  }, [content, pendingAssistantId]);

  // Auto-scroll to bottom when messages or the streaming assistant
  // content change — keeps the newest line in view during a long reply.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, content]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || isStreaming || !activeAgent) return;

    setInput('');
    setMlflowTraceId(null);
    setMlflowTraceUrl(null);

    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: message },
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    setPendingAssistantId(assistantId);

    await send(message);
    setPendingAssistantId(null);
  };

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Chat</h2>
        <p className="text-sm text-muted-foreground mt-1">
          You're talking to <code className="mx-1">planner</code>, a
          markdown agent at
          <code className="mx-1">config/agents/planner/agent.md</code>.
          For computational actions it delegates to its sub-agent
          <code className="mx-1">helper</code> (code-defined at
          <code className="mx-1">server/agents/helper.ts</code>), which
          surfaces as an
          <code className="mx-1">agent-helper</code> tool call.
        </p>
      </div>

      <Card className="h-[min(600px,70vh)] flex flex-col">
        <CardContent
          className="flex-1 overflow-y-auto p-4 space-y-3"
          ref={scrollRef}
        >
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center mt-8">
              Try "help me plan a feature" for a planning conversation,
              or "what time is it?" / "count the words in: the quick
              brown fox" to watch planner delegate to{' '}
              <code>agent-helper</code>.
            </p>
          )}
          {messages.map((m) => {
            if (m.role === 'tool') {
              return (
                <div
                  key={m.id}
                  className="text-xs font-mono text-muted-foreground border-l-2 border-primary/50 pl-3"
                >
                  <span className="font-semibold">tool · {m.toolName}</span>
                  {m.content ? <span className="ml-2">{m.content}</span> : null}
                </div>
              );
            }
            return (
              <div
                key={m.id}
                className={`p-3 rounded-md ${
                  m.role === 'user'
                    ? 'bg-primary/10 ml-12'
                    : 'bg-muted mr-12'
                }`}
              >
                <div className="text-xs text-muted-foreground mb-1">
                  {m.role}
                </div>
                <div className="whitespace-pre-wrap text-sm">
                  {m.content || (isStreaming ? '…' : '')}
                </div>
              </div>
            );
          })}
        </CardContent>

        {mlflowTraceId && (
          <div className="border-t px-4 py-2 text-xs flex items-center justify-between gap-3">
            <code className="truncate" title={mlflowTraceId}>
              {mlflowTraceId}
            </code>
            {mlflowTraceUrl && (
              <a href={mlflowTraceUrl} target="_blank" rel="noreferrer">
                Open trace in MLflow
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-3 border-t flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              activeAgent
                ? `Message ${activeAgent}…`
                : 'No agents registered'
            }
            disabled={!activeAgent || isStreaming}
          />
          <Button
            type="submit"
            disabled={!input.trim() || !activeAgent || isStreaming}
          >
            {isStreaming ? 'Sending…' : 'Send'}
          </Button>
        </form>
      </Card>

      {error && <div className="text-sm text-destructive">Error: {error}</div>}
    </div>
  );
}
