import {
  type AppendMessage,
  AssistantRuntimeProvider,
  createMessageQueue,
  type QuoteInfo,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { type MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ServiceProblem } from "../components/service-problem";
import { SignedOut } from "../components/signed-out";
import { TopBar } from "../components/top-bar";
import { PRODUCT_NAME } from "../config/brand";
import { PAGES, usePageData } from "../config/pages";
import { ActivityPage } from "../features/activity/activity-page";
import { IMAGE_ATTACHMENTS, VOICE_ADAPTERS } from "../features/chat/adapters";
import { ChatContext } from "../features/chat/chat-context";
import { AssistantPage } from "../features/chat/components/assistant-page";
import { toThreadMessage } from "../features/chat/messages";
import { type AgentChat, useAgentChat } from "../features/chat/use-agent-chat";
import { getMe, getModels, useLoaded, useSignOutReference } from "../lib/api-client";
import { href, type Page, pageLinks, useRoute } from "./router";

const SIGNED_OUT_TITLE = "Signed out";

// Skip re-rendering on each delta event
const StableTopBar = memo(TopBar);
const StableAssistantPage = memo(AssistantPage);

function textOf(message: AppendMessage): string {
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function quoteOf(message: AppendMessage): string | undefined {
  return (message.metadata?.custom?.quote as QuoteInfo | undefined)?.text;
}

function imagesOf(message: AppendMessage): string[] {
  return (message.attachments ?? []).flatMap((attachment) =>
    (attachment.content ?? []).flatMap((part) => (part.type === "image" ? [part.image] : [])),
  );
}

// Queue messages while a run is active to prevent concurrent sends.
function useQueuedSends(chat: AgentChat) {
  const latest = useRef(chat);
  latest.current = chat;
  const runs = useRef(0);
  const [queue] = useState(() => {
    const controller = createMessageQueue({
      run: (message) => {
        const before = runs.current;
        latest.current.send(textOf(message), quoteOf(message), imagesOf(message)).finally(() => {
          if (runs.current === before) controller.notifyIdle();
        });
      },
    });
    return controller;
  });
  const [, setChanges] = useState(0);
  useEffect(() => queue.subscribe(() => setChanges((count) => count + 1)), [queue]);
  useEffect(() => {
    if (chat.isRunning) {
      runs.current += 1;
      queue.notifyBusy();
    } else queue.notifyIdle();
  }, [chat.isRunning, queue]);
  return queue;
}

function skipToContent(event: MouseEvent) {
  event.preventDefault();
  document.getElementById("main")?.focus();
}

// Set page title and move focus to heading on navigation for screen reader announcement.
function usePageFocus(page: Page, signedOut: boolean, keepFocus: boolean) {
  const firstPage = useRef(true);
  useEffect(() => {
    const title = pageLinks().find((link) => link.id === page)?.label;
    document.title = `${signedOut ? SIGNED_OUT_TITLE : title} | ${PRODUCT_NAME}`;
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    if (!keepFocus) document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  }, [page, signedOut]);
}

export function App() {
  const route = useRoute();
  const signOutReference = useSignOutReference();
  const { chat, messages } = useAgentChat();
  const [prefill, setPrefill] = useState<string | null>(null);
  const me = useLoaded(getMe);
  const confirmedChanges = chat.activity.filter((row) => row.proposal_id && row.outcome === "allowed").length;
  const { pages, cardData } = usePageData(confirmedChanges);
  const queue = useQueuedSends(chat);
  const listed = useLoaded(getModels);
  const models = useMemo(() => listed.value ?? [], [listed.value]);
  const page: Page = route.page;
  const threads = useMemo(
    () =>
      chat.sessions.map((session) => ({
        status: "regular" as const,
        id: session.id,
        title: session.title ?? undefined,
        lastMessageAt: session.last_activity_time ? new Date(session.last_activity_time) : undefined,
      })),
    [chat.sessions],
  );
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: chat.isRunning,
    convertMessage: toThreadMessage,
    onNew: async (message) => chat.send(textOf(message), quoteOf(message), imagesOf(message)),
    onEdit: async (message) => chat.replace(textOf(message)),
    onCancel: chat.canStop ? async () => chat.stop() : undefined,
    onReload: async (parentId) => {
      const index = parentId === null ? 0 : messages.findIndex((message) => message.id === parentId) + 1;
      const answer = messages.slice(index).find((message) => message.role === "assistant");
      if (answer?.error || answer?.status === "stopped") await chat.retry(answer.id);
      else if (answer?.replaceable) await chat.replace();
    },
    queue: queue.adapter,
    adapters: {
      ...VOICE_ADAPTERS,
      attachments: IMAGE_ATTACHMENTS,
      feedback: { submit: ({ message, type, comment }) => chat.feedback(message.id, { type, comment }) },
      threadList: {
        threads,
        onSwitchToThread: (id) => window.location.assign(href("assistant", id)),
        onSwitchToNewThread: () => window.location.assign(href("assistant")),
        onRename: chat.rename,
        onDelete: chat.remove,
      },
    },
  });
  const conversationId = page === "assistant" ? route.detail : chat.sessionId;
  const { open } = chat;
  useEffect(() => open(conversationId), [open, conversationId]);
  usePageFocus(page, signOutReference !== null, prefill !== null);
  const onPrefilled = useCallback(() => setPrefill(null), []);
  const context = useMemo(() => ({ chat, cardData, models }), [chat, cardData, models]);
  const DataPage = PAGES.find((item) => item.id === page)?.component;

  if (signOutReference !== null) return <SignedOut reference={signOutReference} />;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatContext.Provider value={context}>
        <a
          className="bg-background absolute -top-12 left-4 z-100 rounded-md border px-3.5 py-2 focus:top-2"
          href="#main"
          onClick={skipToContent}
        >
          Skip to main content
        </a>
        <StableTopBar page={page} me={me.value} conversationId={chat.sessionId} />
        <main id="main" className="pb-[calc(var(--tabbar)+env(safe-area-inset-bottom))]" tabIndex={-1}>
          {me.failed ? (
            <div className="mx-6 mt-4 max-md:mx-4 max-md:mt-3">
              <ServiceProblem title="We can't load your profile right now" onRetry={me.retry} />
            </div>
          ) : null}
          {page === "assistant" ? (
            <StableAssistantPage chat={chat} prefill={prefill} onPrefilled={onPrefilled} />
          ) : DataPage ? (
            <DataPage data={pages} detail={route.detail} onAsk={setPrefill} />
          ) : (
            <ActivityPage events={chat.activity} />
          )}
        </main>
      </ChatContext.Provider>
    </AssistantRuntimeProvider>
  );
}
