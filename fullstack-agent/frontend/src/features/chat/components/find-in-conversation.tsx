import { useAuiState } from "@assistant-ui/react";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { ConversationSearch, type SearchHit } from "@/components/assistant-ui/elements/conversation-search";
import { Button } from "@/components/ui/button";

const CONTEXT = 24;

function scrollToMessage(messageId: string) {
  document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)?.scrollIntoView({ block: "center" });
}

/** Search in the open conversation. Only text parts match, never step text or cards. */
export function FindInConversation() {
  const messages = useAuiState((s) => s.thread.messages);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const hits = useMemo(() => {
    if (query === "") return [];
    const needle = query.toLowerCase();
    const found: (SearchHit & { messageId: string })[] = [];
    messages.forEach((message, messageIndex) => {
      const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ");
      const haystack = text.toLowerCase();
      for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
        found.push({
          id: `${message.id}-${at}`,
          messageId: message.id,
          before: text.slice(Math.max(0, at - CONTEXT), at),
          match: text.slice(at, at + query.length),
          after: text.slice(at + query.length, at + query.length + CONTEXT),
          position: (messageIndex / Math.max(1, messages.length - 1)) * 100,
        });
      }
    });
    return found;
  }, [messages, query]);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 max-md:size-11"
        aria-label="Find in conversation"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SearchIcon />
      </Button>
      {open ? (
        <ConversationSearch
          className="bg-background absolute end-2 top-full z-20 mt-2 w-[min(24rem,calc(100%-1rem))] max-w-none"
          query={query}
          hits={hits}
          activeIndex={activeIndex}
          onQueryChange={(next) => {
            setQuery(next);
            setActiveIndex(0);
          }}
          onStep={(delta) => {
            if (hits.length === 0) return;
            const next = (activeIndex + delta + hits.length) % hits.length;
            setActiveIndex(next);
            scrollToMessage(hits[next].messageId);
          }}
        />
      ) : null}
    </>
  );
}
