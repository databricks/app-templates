"use client";

import {
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/elements/attachment.aui";
import { Sources } from "@/components/assistant-ui/elements/sources.aui";
import {
  ComposerQuotePreview,
  QuoteBlock,
  SelectionToolbar,
} from "@/components/assistant-ui/elements/quote.aui";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  ComposerPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Volume2Icon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useState,
  type ComponentType,
  type FC,
} from "react";

/** Thread UI component slots for messages, composer, feedback and suggestions. */
export type ThreadComponents = {
  Welcome: ComponentType;
  Text: ComponentType;
  RunGroup: ComponentType<{ indices: readonly number[] }>;
  RunIndicator: ComponentType;
  Suggestions: ComponentType;
  MessageNotice: ComponentType;
  FeedbackPanel: ComponentType<{ onClose: () => void }>;
  ComposerHeader: ComponentType;
  ComposerTools: ComponentType;
  ComposerStatus: ComponentType;
  RegenerateWith: ComponentType;
  UserMessageHeader: ComponentType;
  UserMessageFooter: ComponentType;
  AssistantMessageHeader: ComponentType;
  AssistantMessageFooter: ComponentType;
  composerPlaceholder: string;
};

type SlotName = Exclude<
  keyof ThreadComponents,
  "composerPlaceholder" | "RunGroup" | "FeedbackPanel"
>;

const ThreadComponentsContext = createContext<ThreadComponents | null>(null);

const useThreadComponents = () => {
  const components = useContext(ThreadComponentsContext);
  if (!components) throw new Error("Thread parts must render inside Thread.");
  return components;
};

const Slot: FC<{ name: SlotName }> = ({ name }) => {
  const Component = useThreadComponents()[name];
  return <Component />;
};

const RunGroup: FC<{ indices: readonly number[] }> = ({ indices }) => {
  const Component = useThreadComponents().RunGroup;
  return <Component indices={indices} />;
};

/** Whether the message in scope belongs to the turn an edit or a regenerate can replace. */
const canReplace = (s: AssistantState) =>
  (s.message.metadata.custom as { canReplace?: boolean }).canReplace === true;

/** Whether the user can rate the answer in scope. */
const canRate = (s: AssistantState) =>
  (s.message.metadata.custom as { canRate?: boolean }).canRate === true;

const messageGroupBy = groupPartByType({
  reasoning: ["group-run"],
  "tool-call": ["group-run"],
  "standalone-tool-call": [],
  source: ["group-sources"],
});

const isNewChatView = (s: AssistantState) => s.thread.messages.length === 0;

export const Thread: FC<{ components: ThreadComponents }> = ({
  components,
}) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadPrimitive.Root
        className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
        style={{
          ["--thread-max-width" as string]: "44rem",
          ["--composer-bg" as string]:
            "color-mix(in oklab, var(--color-muted) 30%, transparent)",
          ["--composer-radius" as string]: "1rem",
          ["--composer-padding" as string]: "8px",
        }}
      >
        <ThreadPrimitive.Viewport
          turnAnchor="top"
          data-slot="aui_thread-viewport"
          className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
        >
          <div
            className={cn(
              "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
              isEmpty && "justify-center",
            )}
          >
            <AuiIf condition={isNewChatView}>
              <Slot name="Welcome" />
            </AuiIf>

            <div
              data-slot="aui_message-group"
              className="mb-14 flex flex-col gap-y-6 empty:hidden"
            >
              <ThreadPrimitive.Messages>
                {() => <ThreadMessage />}
              </ThreadPrimitive.Messages>
            </div>

            <ThreadPrimitive.ViewportFooter
              className={cn(
                "aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-4 md:pb-6",
                !isEmpty &&
                  "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
              )}
            >
              <ThreadScrollToBottom />
              <Slot name="ComposerHeader" />
              <Composer />
              <AuiIf condition={isNewChatView}>
                <div className="aui-thread-welcome-suggestions-shell min-h-19">
                  <AuiIf condition={(s) => s.composer.isEmpty}>
                    <Slot name="Suggestions" />
                  </AuiIf>
                </div>
              </AuiIf>
            </ThreadPrimitive.ViewportFooter>
          </div>
        </ThreadPrimitive.Viewport>
        <SelectionToolbar />
      </ThreadPrimitive.Root>
    </ThreadComponentsContext.Provider>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") {
    return (
      <>
        <Slot name="UserMessageHeader" />
        <UserMessage />
      </>
    );
  }
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

/** Message composer with attachments and command palette. */
const Composer: FC = () => {
  const { composerPlaceholder } = useThreadComponents();
  return (
    <ComposerPrimitive.TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <div
          data-slot="aui_composer-shell"
          className="border-foreground/10 focus-within:border-foreground/25 focus-within:ring-ring/50 flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color] focus-within:ring-[3px]"
        >
          <ComposerQuotePreview className="mx-0 mt-0" />
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder={composerPlaceholder}
            className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
            rows={1}
            enterKeyHint="send"
            aria-label="Message input"
            role="combobox"
            aria-expanded={false}
            addAttachmentOnPaste={false}
          />
          <ComposerAction />
        </div>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.TriggerPopoverRoot>
  );
};

/** Send or Stop button; returns focus to input to prevent unwanted actions. */
const focusComposerInput = (button: HTMLElement) =>
  button
    .closest('[data-slot="aui_composer-shell"]')
    ?.querySelector("textarea")
    ?.focus();

const ComposerAction: FC = () => {
  const isSending = useAuiState(
    (s) =>
      s.composer.submission !== undefined &&
      !(s.thread.isRunning && s.thread.capabilities.cancel),
  );

  return (
    <div className="aui-composer-action-wrapper flex items-center justify-between gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Slot name="ComposerTools" />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Slot name="ComposerStatus" />
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="Voice input"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate text-muted-foreground hover:text-foreground size-7 rounded-full"
                aria-label="Start voice input"
                onMouseDown={(event) => event.preventDefault()}
              >
                <MicIcon className="aui-composer-dictate-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="Stop dictation"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
                aria-label="Stop voice input"
                onMouseDown={(event) => event.preventDefault()}
              >
                <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.composer.canCancel}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-7 rounded-full"
              aria-label="Send message"
              onMouseDown={(event) => {
                if (
                  event.currentTarget
                    .closest('[data-slot="aui_composer-shell"]')
                    ?.matches(":focus-within")
                )
                  event.currentTarget.focus();
                event.preventDefault();
              }}
              onClick={(event) => {
                if (event.detail === 0) focusComposerInput(event.currentTarget);
              }}
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.composer.canCancel}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-7 rounded-full"
              aria-label={isSending ? "Cancel sending" : "Stop generating"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => focusComposerInput(event.currentTarget)}
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const AssistantMessage: FC = () => {
  const status = useAuiState((s) => s.message.status?.type);
  const { FeedbackPanel } = useThreadComponents();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      data-status={status}
      className="fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-2 leading-relaxed wrap-break-word"
      >
        <Slot name="AssistantMessageHeader" />
        <MessagePrimitive.GroupedParts
          groupBy={messageGroupBy}
          indicator="always"
        >
          {({ part, children }) => {
            switch (part.type) {
              case "indicator":
                return <Slot name="RunIndicator" />;
              case "group-run":
                return <RunGroup indices={part.indices} />;
              case "group-sources":
                return (
                  <div
                    data-slot="aui_message-sources"
                    className="in-data-[status=running]:hidden mt-3 flex flex-wrap items-center gap-1.5"
                  >
                    <span className="text-muted-foreground text-xs">
                      Sources
                    </span>
                    {children}
                  </div>
                );
              case "source":
                return <Sources {...part} />;
              case "text":
                return <Slot name="Text" />;
              case "tool-call":
                return part.toolUI;
              case "data":
                return part.dataRendererUI;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <Slot name="MessageNotice" />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className="ms-2 flex min-h-7.5 items-center pt-1.5"
      >
        <AssistantActionBar
          feedbackOpen={feedbackOpen}
          onFeedbackNegative={() => setFeedbackOpen((open) => !open)}
        />
        <Slot name="AssistantMessageFooter" />
      </div>
      {feedbackOpen ? (
        <FeedbackPanel onClose={() => setFeedbackOpen(false)} />
      ) : null}
    </MessagePrimitive.Root>
  );
};

/**
 * The answer's actions. Thumbs up rates it at once; thumbs down opens the
 * feedback panel instead, which sends the rating with its reasons.
 */
const AssistantActionBar: FC<{
  feedbackOpen: boolean;
  onFeedbackNegative: () => void;
}> = ({ feedbackOpen, onFeedbackNegative }) => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in -ms-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <AuiIf condition={(s) => s.thread.capabilities.speech}>
        <AuiIf condition={(s) => s.message.speech == null}>
          <ActionBarPrimitive.Speak asChild>
            <TooltipIconButton tooltip="Read aloud">
              <Volume2Icon />
            </TooltipIconButton>
          </ActionBarPrimitive.Speak>
        </AuiIf>
        <AuiIf condition={(s) => s.message.speech != null}>
          <ActionBarPrimitive.StopSpeaking asChild>
            <TooltipIconButton tooltip="Stop reading">
              <SquareIcon />
            </TooltipIconButton>
          </ActionBarPrimitive.StopSpeaking>
        </AuiIf>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.capabilities.feedback && canRate(s)}>
        <ActionBarPrimitive.FeedbackPositive asChild>
          <TooltipIconButton
            tooltip="Helpful"
            className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground"
          >
            <ThumbsUpIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.FeedbackPositive>
        <ActionBarPrimitive.FeedbackNegative
          asChild
          aria-expanded={feedbackOpen}
          onClick={(event) => {
            event.preventDefault();
            onFeedbackNegative();
          }}
        >
          <TooltipIconButton
            tooltip="Not helpful"
            className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground"
          >
            <ThumbsDownIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.FeedbackNegative>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.capabilities.reload && canReplace(s)}>
        <ActionBarPrimitive.Reload asChild>
          <TooltipIconButton tooltip="Regenerate">
            <RefreshCwIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.Reload>
        <Slot name="RegenerateWith" />
      </AuiIf>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <MessagePrimitive.Quote>
        {(quote) => (
          <div className="col-start-2 min-w-0">
            <QuoteBlock {...quote} />
          </div>
        )}
      </MessagePrimitive.Quote>

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-(--composer-radius) px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>
      <Slot name="UserMessageFooter" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="never"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <AuiIf condition={(s) => s.thread.capabilities.edit && canReplace(s)}>
        <ActionBarPrimitive.Edit asChild>
          <TooltipIconButton tooltip="Edit" className="aui-user-action-edit">
            <PencilIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.Edit>
      </AuiIf>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  const discardedReplies = useAuiState(
    (s) =>
      s.thread.messages
        .slice(s.message.index + 1)
        .filter((message) => message.role === "assistant").length,
  );
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-foreground/10 focus-within:border-foreground/25 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg) transition-[border-color]">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          aria-label="Edit message"
          autoFocus
        />
        {discardedReplies > 0 && (
          <p className="text-muted-foreground mx-4 flex items-center gap-2 text-xs">
            <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden />
            Sending replaces the{" "}
            {discardedReplies === 1 ? "answer" : `${discardedReplies} answers`}{" "}
            below.
          </p>
        )}
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 px-3">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button
              size="sm"
              className="h-8 px-3"
              onMouseDown={(event) => {
                event.currentTarget.focus();
                event.preventDefault();
              }}
            >
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};
