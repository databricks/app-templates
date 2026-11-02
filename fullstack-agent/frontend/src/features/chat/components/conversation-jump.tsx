import { useAui, useAuiState } from "@assistant-ui/react";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { type SearchableThread, ThreadSearch } from "@/components/assistant-ui/elements/thread-search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { dayGroup, dayLabel, NEW_CONVERSATION } from "../../../lib/format";

const SEARCH_CONVERSATIONS = "Search conversations";

/** Search dialog over the conversation list, grouped by day of last activity. */
export function ConversationJump() {
  const aui = useAui();
  const ids = useAuiState((s) => s.threads.threadIds);
  const items = useAuiState((s) => s.threads.threadItems);
  const openId = useAuiState((s) => s.threads.mainThreadId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(openId);
  const threads = useMemo<SearchableThread[]>(() => {
    const now = new Date();
    const listed = items.filter((item) => ids.includes(item.id));
    const timeOf = (item: (typeof listed)[number]) => item.lastMessageAt?.toISOString() ?? "";
    return listed
      .sort((a, b) => timeOf(b).localeCompare(timeOf(a)))
      .map((item) => ({
        id: item.id,
        title: item.title ?? NEW_CONVERSATION,
        preview: timeOf(item) ? dayLabel(timeOf(item), now) : "",
        group: dayGroup(timeOf(item), now),
      }));
  }, [ids, items]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 max-md:size-11" aria-label={SEARCH_CONVERSATIONS}>
          <SearchIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="top-16 translate-y-0 p-0 sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">{SEARCH_CONVERSATIONS}</DialogTitle>
        <ThreadSearch
          className="max-w-none border-0"
          threads={threads}
          query={query}
          activeId={activeId}
          onQueryChange={(next) => {
            setQuery(next);
            const matches = threads.filter((thread) =>
              `${thread.title} ${thread.preview}`.toLowerCase().includes(next.toLowerCase()),
            );
            if (matches[0]) setActiveId(matches[0].id);
          }}
          onActiveChange={setActiveId}
          onSelect={(id) => {
            setOpen(false);
            aui.threads.item({ id }).switchTo();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
