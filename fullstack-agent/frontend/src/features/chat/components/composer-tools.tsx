import { type TriggerItem, unstable_useMentionAdapter, unstable_useSlashCommandAdapter } from "@assistant-ui/react";
import { AtSignIcon, ShrinkIcon } from "lucide-react";
import { type MouseEvent, useMemo } from "react";
import { ComposerTriggerPopover } from "@/components/assistant-ui/elements/composer-trigger-popover.aui";
import { mentionItems } from "../../../config/suggestions";
import { useChat } from "../chat-context";
import { AttachImage, ModelChoice } from "./models";

const COMPACT = "Summarise earlier messages, so the assistant reads less";
const NO_COMMANDS = "Commands work in a conversation, between answers";

/** Keep focus in place on a composer control: on a phone, focus hides the tab bar mid-tap. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** A mention goes into the message as its plain label, so the sent message reads as typed. */
const PLAIN = {
  serialize: (item: TriggerItem) => item.label,
  parse: (text: string) => [{ kind: "text" as const, text }],
};

/** The `/` commands between runs and the `@` mentions of data the user's cards name. */
function ComposerTriggers() {
  const { chat, cardData } = useChat();
  const canCompact = chat.sessionId !== null && !chat.isRunning;
  const { compact } = chat;
  const commands = useMemo(
    () => (canCompact ? [{ id: "compact", description: COMPACT, execute: () => void compact() }] : []),
    [canCompact, compact],
  );
  const slash = unstable_useSlashCommandAdapter({ commands, removeOnExecute: true });
  const items = useMemo(() => mentionItems(cardData), [cardData]);
  const mention = unstable_useMentionAdapter({ items, formatter: PLAIN });
  return (
    <>
      <ComposerTriggerPopover
        char="/"
        adapter={slash.adapter}
        action={slash.action}
        fallbackIcon={ShrinkIcon}
        emptyItemsLabel={NO_COMMANDS}
        onMouseDown={keepFocus}
      />
      <ComposerTriggerPopover
        char="@"
        adapter={mention.adapter}
        directive={mention.directive}
        fallbackIcon={AtSignIcon}
        onMouseDown={keepFocus}
      />
    </>
  );
}

/** The composer's tools: the attach button, the model and effort, and the `/` and `@` popovers. */
export function ComposerTools() {
  return (
    <>
      <AttachImage />
      <ModelChoice />
      <ComposerTriggers />
    </>
  );
}
