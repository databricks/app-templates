import { useEffect } from "react";
import { ThreadListSidebar } from "@/components/assistant-ui/elements/threadlist-sidebar.aui";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { href, useRoute } from "../../../app/router";
import { Icon } from "../../../components/icons";
import { Loading } from "../../../components/loading";
import { ServiceProblem } from "../../../components/service-problem";
import { dayLabel, NEW_CONVERSATION } from "../../../lib/format";
import type { AgentChat } from "../use-agent-chat";
import { ConversationJump } from "./conversation-jump";
import { FindInConversation } from "./find-in-conversation";
import { Thread } from "./thread";

type AssistantProps = { chat: AgentChat; prefill: string | null; onPrefilled: () => void };

function ListNotes({ chat }: { chat: AgentChat }) {
  return (
    <>
      {!chat.sessionsLoaded ? (
        <p className="text-muted-foreground px-2.5 py-2 text-sm" role="status">
          Loading your conversations
        </p>
      ) : chat.sessionsFailed ? (
        <p className="text-muted-foreground px-2.5 py-2 text-sm">We can't show your earlier conversations right now.</p>
      ) : chat.sessions.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-2 text-sm">No conversations yet</p>
      ) : null}
      {chat.listError ? (
        <p className="mx-0.5 my-1 rounded-md bg-red-50 px-2.5 py-2 text-sm text-red-700" role="alert">
          {chat.listError}
        </p>
      ) : null}
    </>
  );
}

/** The list's toggle. A conversation or New conversation chosen in the drawer closes it. */
function ListToggle() {
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar();
  const route = useRoute();
  useEffect(() => setOpenMobile(false), [route.detail, setOpenMobile]);
  return <SidebarTrigger className="size-9 max-md:size-11" aria-label="Conversation list" aria-expanded={isMobile ? openMobile : open} />;
}

/** The conversation list beside the chat: docked on wide screens, a drawer on phones. */
export function AssistantPage({ chat, prefill, onPrefilled }: AssistantProps) {
  const listed = chat.sessions.find((session) => session.id === chat.sessionId);
  const title =
    chat.state === "new"
      ? NEW_CONVERSATION
      : chat.state === "missing"
        ? "Conversation not found"
        : (listed?.title ?? chat.title ?? NEW_CONVERSATION);
  const date = chat.state !== "missing" && listed?.last_activity_time ? dayLabel(listed.last_activity_time, new Date()) : null;

  return (
    <SidebarProvider className="relative h-[calc(100dvh-var(--topbar)-var(--tabbar)-env(safe-area-inset-bottom))] min-h-0">
      <ThreadListSidebar className="absolute h-full" headerAction={<ConversationJump />}>
        <ListNotes chat={chat} />
      </ThreadListSidebar>
      <section className="bg-background relative flex min-w-0 flex-1 flex-col" aria-labelledby="chat-title">
        <header className="relative flex min-h-14 shrink-0 items-center gap-2 border-b px-3 [@media(height<=500px)]:min-h-11">
          <ListToggle />
          <div className="min-w-0">
            <h1 id="chat-title" tabIndex={-1} className="truncate text-base font-semibold">
              {title}
            </h1>
            {date ? <p className="text-muted-foreground text-xs">{date}</p> : null}
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-1">
            {chat.state === "ready" ? <FindInConversation /> : null}
            <Button asChild variant="ghost" size="icon" className="size-9 max-md:size-11">
              <a href={href("assistant")} aria-label="New conversation">
                <Icon name="plus" />
              </a>
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          {chat.state === "loading" ? (
            <div className="p-6">
              <Loading text="Loading the conversation" />
            </div>
          ) : chat.state === "failed" ? (
            <div className="p-6 max-md:px-4">
              <ServiceProblem title="We can't show this conversation right now" onRetry={chat.reload} />
            </div>
          ) : chat.state === "missing" ? (
            <div className="flex flex-col items-start gap-3 p-6 max-md:px-4">
              <p className="font-semibold">We can't find this conversation.</p>
              <p>Check the link, or start a new conversation.</p>
              <Button asChild variant="outline">
                <a href={href("assistant")}>
                  <Icon name="plus" className="size-4" />
                  Start a new conversation
                </a>
              </Button>
            </div>
          ) : (
            <Thread prefill={prefill} onPrefilled={onPrefilled} />
          )}
        </div>
      </section>
    </SidebarProvider>
  );
}
