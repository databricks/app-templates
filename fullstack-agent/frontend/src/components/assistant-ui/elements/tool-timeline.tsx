"use client";

import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  CollapsibleRoot as Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible-root";
import { collapsePanel, ShimmerLabel, SwapLabel } from "./surfaces";

export interface TimelineStep {
  id: string;
  verb: ReactNode;
  icon: LucideIcon;
  detail?: ReactNode;
}

export interface ToolTimelineProps {
  steps: readonly TimelineStep[];
  streaming: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restingLabel: string;
  activeLabel: string;
  className?: string;
}

export function ToolTimeline({
  steps,
  streaming,
  open,
  onOpenChange,
  restingLabel,
  activeLabel,
  className,
}: ToolTimelineProps) {
  return (
    <Collapsible
      data-slot="tool-timeline"
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-full max-w-sm", className)}
    >
      <CollapsibleTrigger className="group/trigger text-muted-foreground hover:text-foreground/90 focus-visible:ring-ring/50 flex items-center gap-1.5 rounded-md py-1 text-[13.5px] transition-colors outline-none focus-visible:ring-[3px]">
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none" />
        <SwapLabel
          active={streaming ? 0 : 1}
          className="text-start tabular-nums"
        >
          <ShimmerLabel
            active={streaming}
            className="relative inline-block leading-none"
          >
            {activeLabel}
          </ShimmerLabel>
          <>{restingLabel}</>
        </SwapLabel>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className="flex flex-col gap-2.5 ps-4 pt-2.5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const active = streaming && index === steps.length - 1;

            return (
              <div
                key={step.id}
                className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex flex-col gap-2 duration-300"
              >
                <div className="text-muted-foreground flex items-start gap-2 text-[13.5px]">
                  <Icon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                  <ShimmerLabel
                    active={active}
                    className="relative inline-block min-w-0 leading-snug wrap-anywhere"
                  >
                    {step.verb}
                  </ShimmerLabel>
                </div>
                {step.detail}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
