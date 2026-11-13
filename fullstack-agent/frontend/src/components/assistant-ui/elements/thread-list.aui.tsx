"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "lucide-react";
import {
  forwardRef,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";
import { href, useRoute } from "../../../app/router";
import { PRODUCT_NAME } from "../../../config/brand";
import { TITLE_MAX_LENGTH } from "../../../features/chat/use-agent-chat";
import { dayGroup, NEW_CONVERSATION, shortDate } from "../../../lib/format";

export const ThreadList: FC = () => {
  const [search, setSearch] = useState("");
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);

  return (
    <ThreadListRoot>
      <ThreadListNew />
      {hasThreads && (
        <ThreadListSearch value={search} onValueChange={setSearch} />
      )}
      <ThreadListItems searchQuery={hasThreads ? search : ""} />
    </ThreadListRoot>
  );
};

export const ThreadListSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
  }
>(({ className, value, onValueChange, ...props }, ref) => {
  return (
    <div data-slot="aui_thread-list-search" className="relative px-0.5 py-1">
      <SearchIcon
        data-slot="aui_thread-list-search-icon"
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
      />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label="Search conversations"
        placeholder="Search conversations"
        className={cn("h-8 ps-8 text-sm", className)}
        {...props}
      />
    </div>
  );
});

ThreadListSearch.displayName = "ThreadListSearch";

export const ThreadListRoot: FC<
  ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>
> = ({ className, ...props }) => {
  return (
    <ThreadListPrimitive.Root
      data-slot="aui_thread-list-root"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  );
};

export const ThreadListItems: FC<
  ComponentPropsWithoutRef<"div"> & { searchQuery?: string }
> = ({ className, searchQuery = "", ...props }) => {
  return (
    <div
      data-slot="aui_thread-list-items"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    >
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        <ThreadListItemGroups searchQuery={searchQuery} />
      </AuiIf>
    </div>
  );
};

const dateGroupLabel = (
  date: Date | undefined,
  startOfToday: number,
  startOfYesterday: number,
): string => {
  if (!date || date.getTime() >= startOfToday) return "Today";
  if (date.getTime() >= startOfYesterday) return "Yesterday";
  return "Earlier";
};

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const subscribeToNextDay = (onDayChange: () => void) => {
  let timeout: number;
  const scheduleNextDay = () => {
    const now = new Date();
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    timeout = window.setTimeout(() => {
      onDayChange();
      scheduleNextDay();
    }, startOfTomorrow - now.getTime());
  };
  scheduleNextDay();
  return () => window.clearTimeout(timeout);
};

const getStartOfToday = () => startOfLocalDay(new Date());

const useStartOfToday = () =>
  useSyncExternalStore(subscribeToNextDay, getStartOfToday);

export type ThreadListGroup = { label: string; indices: number[] };

/**
 * Filters threads by title and buckets by activity (Today, Yesterday, Earlier).
 * `groups` is null if no dates present or during server/hydration; use `filteredIndices`.
 */
export const useThreadListGroups = (searchQuery = "") => {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);

  const query = searchQuery.trim().toLowerCase();
  const startOfToday = useStartOfToday();

  return useMemo(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]));
    const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt);
    const filteredIndices = threadIds
      .map((id, index) => ({ id, index }))
      .filter(
        ({ id }) =>
          !query ||
          (itemsById.get(id)?.title || NEW_CONVERSATION)
            .toLowerCase()
            .includes(query),
      )
      .map(({ index }) => index);
    if (!filteredIndices.some((index) => dates[index])) {
      return { threadIds, filteredIndices, groups: null };
    }

    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);
    const startOfYesterday = yesterday.getTime();
    const time = (index: number) =>
      dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const sorted = [...filteredIndices].sort((a, b) => time(b) - time(a));

    const result: ThreadListGroup[] = [];
    for (const index of sorted) {
      const label = dateGroupLabel(
        dates[index],
        startOfToday,
        startOfYesterday,
      );
      const lastGroup = result[result.length - 1];
      if (lastGroup?.label === label) {
        lastGroup.indices.push(index);
      } else {
        result.push({ label, indices: [index] });
      }
    }
    return { threadIds, filteredIndices, groups: result };
  }, [threadIds, threadItems, query, startOfToday]);
};

const ThreadListItemGroups: FC<{ searchQuery?: string }> = ({
  searchQuery = "",
}) => {
  const { threadIds, filteredIndices, groups } =
    useThreadListGroups(searchQuery);
  const query = searchQuery.trim();

  if (query && filteredIndices.length === 0) {
    return (
      <div
        data-slot="aui_thread-list-empty"
        className="text-muted-foreground px-2.5 py-4 text-sm"
      >
        No conversations found
      </div>
    );
  }

  if (!groups) {
    return filteredIndices.map((index) => (
      <ThreadListPrimitive.ItemByIndex
        key={threadIds[index]}
        index={index}
        components={{ ThreadListItem }}
      />
    ));
  }

  return groups.map((group) => (
    <Fragment key={group.label}>
      <h3
        data-slot="aui_thread-list-group-label"
        className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium"
      >
        {group.label}
      </h3>
      {group.indices.map((index) => (
        <ThreadListPrimitive.ItemByIndex
          key={threadIds[index]}
          index={index}
          components={{ ThreadListItem }}
        />
      ))}
    </Fragment>
  ));
};

export const ThreadListNew = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
>(({ className, labelClassName, children, ...props }, ref) => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        ref={ref}
        variant="ghost"
        data-slot="aui_thread-list-new"
        className={cn(
          "hover:bg-muted data-active:bg-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal max-md:h-11",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <PlusIcon
              data-slot="aui_thread-list-new-icon"
              className="size-4 shrink-0"
            />
            <span
              data-slot="aui_thread-list-new-label"
              className={cn("whitespace-nowrap", labelClassName)}
            >
              New conversation
            </span>
          </>
        )}
      </Button>
    </ThreadListPrimitive.New>
  );
});

ThreadListNew.displayName = "ThreadListNew";

const ThreadListSkeleton: FC = () => {
  return (
    <div
      role="status"
      aria-label="Loading conversations"
      className="flex flex-col gap-0.5"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-slot="aui_thread-list-skeleton-wrapper"
          className="flex h-8 items-center px-2.5"
        >
          <Skeleton
            data-slot="aui_thread-list-skeleton"
            className="h-3.5 w-full"
          />
        </div>
      ))}
    </div>
  );
};

/**
 * A conversation link with date (if older than yesterday) and rename/delete menu.
 * Delete confirms first and moves focus to next conversation.
 */
export const ThreadListItem: FC = () => {
  const id = useAuiState((s) => s.threadListItem.id);
  const title = useAuiState((s) => s.threadListItem.title) ?? NEW_CONVERSATION;
  const isCurrent = useRoute().detail === id;
  const isRunning = useAuiState((s) => s.threadListItem.isRunning);
  const lastMessageAt = useAuiState((s) => s.threadListItem.lastMessageAt);
  const now = new Date();
  const date =
    lastMessageAt &&
    dayGroup(lastMessageAt.toISOString(), now) === "Earlier"
      ? shortDate(lastMessageAt.toISOString(), now)
      : null;
  const [isRenaming, setIsRenaming] = useState(false);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (isRenaming || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [isRenaming]);

  return (
    <ThreadListItemPrimitive.Root
      data-slot="aui_thread-list-item"
      className="group/item hover:bg-muted focus-visible:bg-muted has-[[aria-current=page]]:bg-muted has-focus-visible:bg-muted has-data-[state=open]:bg-muted relative flex h-8 items-center max-md:h-11 rounded-md transition-colors focus-visible:outline-none"
    >
      {isRenaming ? (
        <ThreadListItemRename
          onDone={(restoreFocus) => {
            restoreFocusRef.current = restoreFocus;
            setIsRenaming(false);
          }}
        />
      ) : (
        <ThreadListItemPrimitive.Trigger asChild>
          <a
            ref={triggerRef}
            href={href("assistant", id)}
            title={title}
            aria-current={isCurrent ? "page" : undefined}
            data-slot="aui_thread-list-item-trigger"
            className="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center rounded-md px-2.5 text-start text-sm outline-none group-hover/item:pe-9 group-has-focus-visible/item:pe-9 group-has-data-[state=open]/item:pe-9 group-has-[[aria-current=page]]/item:pe-9 focus-visible:ring-1"
          >
            {isRunning && (
              <Loader2Icon
                aria-hidden
                data-slot="aui_thread-list-item-running"
                className="text-muted-foreground me-1.5 size-3.5 shrink-0 animate-spin"
              />
            )}
            <span
              data-slot="aui_thread-list-item-title"
              className="min-w-0 flex-1 truncate"
            >
              <ThreadListItemPrimitive.Title fallback={NEW_CONVERSATION} />
            </span>
            {date && (
              <span
                data-slot="aui_thread-list-item-date"
                className="text-muted-foreground ms-2 shrink-0 text-xs group-hover/item:hidden group-has-focus-visible/item:hidden group-has-data-[state=open]/item:hidden group-has-[[aria-current=page]]/item:hidden"
              >
                {date}
              </span>
            )}
            {isRunning && <span className="sr-only">Running</span>}
          </a>
        </ThreadListItemPrimitive.Trigger>
      )}
      <ThreadListItemMore title={title} onRename={() => setIsRenaming(true)} />
    </ThreadListItemPrimitive.Root>
  );
};

/**
 * Save when focus leaves, not on unmount, so focus is not dropped inside the focus trap.
 */
const ThreadListItemRename: FC<{
  onDone: (restoreFocus: boolean) => void;
}> = ({ onDone }) => {
  const aui = useAui();
  const title = useAuiState((s) => s.threadListItem.title) ?? "";
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = (restoreFocus: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;

    const next = value.trim();
    if (!next || next === title) {
      onDone(restoreFocus);
      return;
    }

    Promise.resolve()
      .then(() => aui.threadListItem.rename(next))
      .then(
        () => onDone(restoreFocus),
        () => {
          settledRef.current = false;
          if (restoreFocus) inputRef.current?.focus();
        },
      );
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onDone(true);
  };

  return (
    <Input
      ref={inputRef}
      autoFocus
      data-slot="aui_thread-list-item-rename"
      aria-label={`New title for ${title}`}
      maxLength={TITLE_MAX_LENGTH}
      value={value}
      className="h-7 min-w-0 flex-1 ps-2.5 pe-9 text-sm"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => window.setTimeout(() => commit(false))}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
};

const ThreadListItemMore: FC<{ title: string; onRename: () => void }> = ({
  title,
  onRename,
}) => {
  const aui = useAui();
  const [isConfirming, setIsConfirming] = useState(false);
  const [more, setMore] = useState<HTMLButtonElement | null>(null);
  const actionRef = useRef<(() => void) | null>(null);
  const afterDeleteRef = useRef<HTMLElement | null>(null);

  const confirmDelete = () => {
    const links = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-slot="aui_thread-list-item-trigger"]',
      ),
    ];
    const own = more
      ?.closest('[data-slot="aui_thread-list-item"]')
      ?.querySelector('[data-slot="aui_thread-list-item-trigger"]');
    const next = links[links.findIndex((link) => link === own) + 1];
    afterDeleteRef.current =
      next ??
      document.querySelector<HTMLElement>('[data-slot="aui_thread-list-new"]');
    setIsConfirming(false);
  };

  return (
    <>
      <ThreadListItemMorePrimitive.Root sharedFocusGroup>
        <ThreadListItemMorePrimitive.Trigger asChild>
          <Button
            ref={setMore}
            variant="ghost"
            size="icon"
            data-slot="aui_thread-list-item-more"
            className="data-[state=open]:bg-accent absolute end-1.5 top-1/2 size-6 -translate-y-1/2 p-0 opacity-0 group-hover/item:opacity-100 group-has-focus-visible/item:opacity-100 group-has-[[aria-current=page]]/item:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon className="size-3.5" />
            <span className="sr-only">More actions for {title}</span>
          </Button>
        </ThreadListItemMorePrimitive.Trigger>
        <ThreadListItemMorePrimitive.Content
          side="right"
          align="start"
          sideOffset={6}
          data-slot="aui_thread-list-item-more-content"
          portalProps={{ container: more?.parentElement }}
          onCloseAutoFocus={(event) => {
            const chosen = actionRef.current;
            if (!chosen) return;
            actionRef.current = null;
            event.preventDefault();
            chosen();
          }}
          className="bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 overflow-hidden rounded-xl border p-1.5"
        >
          <ThreadListItemMorePrimitive.Item
            data-slot="aui_thread-list-item-more-item"
            className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
            onSelect={() => (actionRef.current = onRename)}
          >
            <PencilIcon className="size-4" />
            Rename
          </ThreadListItemMorePrimitive.Item>
          <ThreadListItemMorePrimitive.Item
            data-slot="aui_thread-list-item-more-item"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
            onSelect={() => (actionRef.current = () => setIsConfirming(true))}
          >
            <TrashIcon className="size-4" />
            Delete
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemMorePrimitive.Content>
      </ThreadListItemMorePrimitive.Root>
      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const afterDelete = afterDeleteRef.current;
            if (!afterDelete) {
              more?.focus();
              return;
            }
            afterDelete.focus();
            aui.threadListItem.delete();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete this conversation?</DialogTitle>
            <DialogDescription>
              "{title}" leaves your conversation list. {PRODUCT_NAME} keeps its
              records of the conversation for the time its retention policy
              sets.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" autoFocus>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
