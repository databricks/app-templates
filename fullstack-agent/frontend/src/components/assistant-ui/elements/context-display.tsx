"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getBarColor, getPercentColor, getStrokeColor, getUsagePercent } from "../utils/context-usage";
import { formatTokenCount } from "../utils/tokens";

const RING_SIZE = 18;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type ContextDisplayRingProps = {
  modelContextWindow: number;
  totalTokens: number;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
};

/** How full the model's context window is, as a ring and a percentage, with the token counts in a tooltip. */
export function ContextDisplayRing({ modelContextWindow, totalTokens, side = "top", className }: ContextDisplayRingProps) {
  const percent = getUsagePercent(totalTokens, modelContextWindow);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-slot="context-display-trigger"
            aria-label={`Context ${Math.round(percent)}% full`}
            className={cn(
              "text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors",
              className,
            )}
          >
            <svg
              aria-hidden="true"
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              className="-rotate-90"
            >
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                strokeWidth={RING_STROKE}
                className="stroke-border"
              />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE - (percent / 100) * RING_CIRCUMFERENCE}
                className={cn("transition-[stroke-dashoffset,stroke] duration-300", getStrokeColor(percent))}
              />
            </svg>
            <span className="font-mono tabular-nums">{Math.round(percent)}%</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          sideOffset={8}
          data-slot="context-display-popover"
          className="bg-popover text-popover-foreground block w-56 border p-3 text-left [&_[data-slot=tooltip-arrow]]:hidden"
        >
          <div className="text-xs">
            <div className="flex items-baseline justify-between gap-6 whitespace-nowrap">
              <span className={getPercentColor(percent)}>{Math.round(percent)}% full</span>
              <span className="font-mono tabular-nums">
                {formatTokenCount(Math.min(totalTokens, modelContextWindow))} / {formatTokenCount(modelContextWindow)}
              </span>
            </div>
            <div
              data-slot="context-display-track"
              className="bg-muted inset-ring-border mt-2.5 h-1 overflow-hidden rounded-full inset-ring forced-colors:border"
            >
              <div
                className={cn(
                  "h-full w-(--usage-width) rounded-full transition-[width] duration-300 forced-color-adjust-none",
                  totalTokens > 0 && "min-w-1",
                  getBarColor(percent),
                )}
                style={{ "--usage-width": `${percent}%` } as React.CSSProperties}
              />
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
