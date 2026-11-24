import { useAuiState } from "@assistant-ui/react";
import { CommandIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CommandPalette, type PaletteCommand } from "@/components/assistant-ui/elements/command-palette";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { href, type Page, pageLinks } from "../app/router";
import { NEW_CONVERSATION } from "../lib/format";

const NEW = "new";
const PAGE_PREFIX = "page:";
const CONVERSATION_PREFIX = "conversation:";

function target(id: string): string {
  if (id === NEW) return href("assistant");
  if (id.startsWith(PAGE_PREFIX)) return href(id.slice(PAGE_PREFIX.length) as Page);
  return href("assistant", id.slice(CONVERSATION_PREFIX.length));
}

// Command palette for new conversation, pages, and listed conversations (Ctrl+K / Cmd+K).
export function CommandMenu() {
  const ids = useAuiState((s) => s.threads.threadIds);
  const items = useAuiState((s) => s.threads.threadItems);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(NEW);
  const commands = useMemo<PaletteCommand[]>(
    () => [
      { id: NEW, label: NEW_CONVERSATION, group: "Assistant" },
      ...pageLinks().map((link) => ({ id: `${PAGE_PREFIX}${link.id}`, label: `Go to ${link.label}`, group: "Pages" })),
      ...items
        .filter((item) => ids.includes(item.id))
        .map((item) => ({
          id: `${CONVERSATION_PREFIX}${item.id}`,
          label: item.title ?? NEW_CONVERSATION,
          group: "Conversations",
        })),
    ],
    [ids, items],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const show = (value: boolean) => {
    setOpen(value);
    setQuery("");
    setActiveId(NEW);
  };
  return (
    <>
      <Button variant="ghost" size="icon" className="max-md:size-11" aria-label="Commands" onClick={() => show(true)}>
        <CommandIcon />
      </Button>
      <Dialog open={open} onOpenChange={show}>
        <DialogContent className="top-16 translate-y-0 border-0 bg-transparent p-0 shadow-none sm:max-w-md" showCloseButton={false}>
          <DialogTitle className="sr-only">Commands</DialogTitle>
          <CommandPalette
            className="max-w-none"
            commands={commands}
            query={query}
            activeId={activeId}
            onQueryChange={(next) => {
              setQuery(next);
              const first = commands.find((command) => command.label.toLowerCase().includes(next.toLowerCase()));
              if (first) setActiveId(first.id);
            }}
            onActiveChange={setActiveId}
            onRun={(id) => {
              show(false);
              window.location.assign(target(id));
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
