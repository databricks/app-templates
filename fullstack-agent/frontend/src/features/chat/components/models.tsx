import { useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { ChevronDownIcon } from "lucide-react";
import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { ComposerAddAttachment } from "@/components/assistant-ui/elements/attachment.aui";
import { ContextDisplayRing } from "@/components/assistant-ui/elements/context-display";
import { ClaudeLogo } from "@/components/assistant-ui/elements/logos";
import {
  ModelSelectorContent,
  ModelSelectorRoot,
  ModelSelectorTrigger,
} from "@/components/assistant-ui/elements/model-selector";
import { RegenerateMenu } from "@/components/assistant-ui/elements/regenerate-menu";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Model } from "../../../lib/api-client";
import type { Effort } from "../api";
import { useChat } from "../chat-context";
import type { MessageExtras } from "../types";

const READS_IMAGES = "Reads images";

const NOT_AN_IMAGE = "Attach a PNG, JPEG, GIF or WebP image.";

/** The most images a question carries, as the backend allows. */
const MAX_IMAGES = 3;

const EFFORTS: readonly { id: Effort; name: string }[] = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
];

/** Keep focus in place on a composer control: on a phone, focus hides the tab bar mid-tap. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** The model a question runs on: the chosen one, or the default. */
function useChosenModel(): Model | undefined {
  const { chat, models } = useChat();
  return models.find((model) => model.id === chat.model) ?? models[0];
}

/** The attach button, shown while the model the next question runs on reads images. */
export function AttachImage() {
  return useChosenModel()?.images ? <ImagePicker /> : null;
}

/** The attach button while the question has room for an image, and why the last picked file was refused. */
function ImagePicker() {
  const count = useAuiState((state) => state.composer.attachments.length);
  const [refused, setRefused] = useState(false);
  useEffect(() => setRefused(false), [count]);
  useAuiEvent("composer.attachmentAddError", ({ reason }) => setRefused(reason === "not-accepted"));
  useAuiEvent("composer.send", () => setRefused(false));
  return (
    <>
      {count < MAX_IMAGES ? <ComposerAddAttachment /> : null}
      <p className="text-muted-foreground order-last basis-full px-1.5 text-xs empty:sr-only" role="status">
        {refused ? NOT_AN_IMAGE : null}
      </p>
    </>
  );
}

/**
 * Model and effort for the next question, shown with two models or more.
 * A model that reads no images removes the attached images.
 */
export function ModelChoice() {
  const { chat, models } = useChat();
  const aui = useAui();
  const chosen = useChosenModel();
  const options = useMemo(
    () =>
      models.map((model) => ({
        id: model.id,
        name: model.name,
        description: model.images ? READS_IMAGES : undefined,
        icon: <ClaudeLogo />,
        efforts: EFFORTS,
      })),
    [models],
  );
  if (options.length < 2 || !chosen) return null;
  const choose = (id: string) => {
    chat.setModel(id);
    if (!models.find((model) => model.id === id)?.images) aui.composer.clearAttachments();
  };
  return (
    <div className="contents" onMouseDown={keepFocus}>
      <ModelSelectorRoot
        models={options}
        value={chosen.id}
        onValueChange={choose}
        effort={chat.effort}
        onEffortChange={(effort) => chat.setEffort(effort as Effort)}
      >
        <ModelSelectorTrigger
          variant="ghost"
          size="sm"
          className="min-w-0"
          aria-label={`Model: ${chosen.name}, ${EFFORTS.find((effort) => effort.id === chat.effort)?.name}`}
        />
        <ModelSelectorContent side="top" className="max-w-[calc(100vw-2rem)]" aria-label="Models" />
      </ModelSelectorRoot>
    </div>
  );
}

/** How full the latest run left the context window of the model the next question runs on, beside Send. */
export function ContextUsage() {
  const chosen = useChosenModel();
  const tokens = useAuiState(
    (state) =>
      state.thread.messages.flatMap((message) => (message.metadata.custom as MessageExtras).contextTokens ?? []).at(-1) ?? 0,
  );
  if (!chosen || tokens === 0) return null;
  return <ContextDisplayRing modelContextWindow={chosen.context_window} totalTokens={tokens} />;
}

/** Regenerate the last answer on another model; with images, only models that read them. */
export function RegenerateWith() {
  const { chat, models } = useChat();
  const extras = useAuiState((state) => state.message.metadata.custom as MessageExtras);
  const [open, setOpen] = useState(false);
  const choices = models.filter((model) => !extras.images || model.images);
  if (choices.length < 2) return null;
  const options = choices.map((model) => ({ id: model.id, label: model.name, detail: "" }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TooltipIconButton tooltip="Ask another model" className="data-[state=open]:bg-accent">
          <ChevronDownIcon />
        </TooltipIconButton>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        aria-label="Other models"
        className="w-72 max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none"
      >
        <RegenerateMenu
          className="max-w-none"
          options={options}
          currentId={extras.model ?? models[0].id}
          onPick={(model) => {
            setOpen(false);
            chat.replace(undefined, model);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
