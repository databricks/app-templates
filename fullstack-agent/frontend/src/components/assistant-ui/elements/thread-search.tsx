"use client";

import { useId, type ComponentProps } from "react";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { field, mono, paper } from "./surfaces";

export interface SearchableThread {
  id: string;
  title: string;
  group: string;
  preview: string;
}

/**
 * Filter conversations by title and preview, grouped as given. Arrow keys move
 * highlight from edge (when hidden by query), Enter or click selects.
 */
export function ThreadSearch({
  threads,
  query,
  activeId,
  onQueryChange,
  onActiveChange,
  onSelect,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "onSelect"
> & {
  threads: readonly SearchableThread[];
  query: string;
  activeId: string;
  onQueryChange: (query: string) => void;
  onActiveChange: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const listId = useId();
  const optionId = (id: string) => `${listId}-${id}`;
  const matches = threads.filter((thread) =>
    `${thread.title} ${thread.preview}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = [...new Set(matches.map((thread) => thread.group))];
  const ordered = groups.flatMap((group) =>
    matches.filter((thread) => thread.group === group),
  );

  const move = (delta: number) => {
    if (ordered.length === 0) return false;
    const at = ordered.findIndex((thread) => thread.id === activeId);
    const from = at === -1 ? (delta > 0 ? -1 : 0) : at;
    const next = ordered[(from + delta + ordered.length) % ordered.length];
    if (!next) return false;
    onActiveChange(next.id);
    document
      .getElementById(optionId(next.id))
      ?.scrollIntoView({ block: "nearest" });
    return true;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    if (event.key === "ArrowDown") {
      if (move(1)) event.preventDefault();
    } else if (event.key === "ArrowUp") {
      if (move(-1)) event.preventDefault();
    } else if (event.key === "Enter") {
      const active = ordered.find((thread) => thread.id === activeId);
      if (active) {
        event.preventDefault();
        onSelect(active.id);
      }
    }
  };

  return (
    <div
      data-slot="thread-search"
      className={cn(
        paper,
        "flex w-full max-w-sm flex-col gap-1.5 rounded-2xl p-3",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          field,
          "flex items-center gap-2 rounded-xl px-2.5 py-1.5",
        )}
      >
        <SearchIcon className="text-muted-foreground size-3.5 shrink-0" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search threads"
          aria-label="Search threads"
          role="combobox"
          aria-expanded={true}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            ordered.some((thread) => thread.id === activeId)
              ? optionId(activeId)
              : undefined
          }
          className="text-foreground/85 placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Threads"
        className="flex flex-col gap-1.5"
      >
        {groups.map((group) => (
          <div
            key={group}
            role="group"
            aria-label={group}
            className="flex flex-col"
          >
            <span
              aria-hidden
              className={cn(mono, "text-muted-foreground px-2 pb-1")}
            >
              {group}
            </span>
            {matches
              .filter((thread) => thread.group === group)
              .map((thread) => (
                <button
                  key={thread.id}
                  id={optionId(thread.id)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={thread.id === activeId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onActiveChange(thread.id);
                    onSelect(thread.id);
                  }}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-xl px-2 py-1 text-start transition-colors",
                    thread.id === activeId
                      ? "bg-foreground/[0.05]"
                      : "hover:bg-foreground/[0.03]",
                  )}
                >
                  <span className="min-w-0 truncate text-[13px]">
                    {thread.title}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {thread.preview}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>

      {matches.length === 0 && (
        <span
          role="status"
          className="text-muted-foreground px-2 py-4 text-center text-xs"
        >
          No thread matches “{query}”
        </span>
      )}
    </div>
  );
}
