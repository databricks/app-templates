"use client";

import type { ComponentProps } from "react";
import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { inkButton, paper } from "./surfaces";
import { useReceiptFocus } from "./receipt-focus";

export type RecommendationState = "idle" | "accepted";

export function RecommendationCard({
  state,
  question,
  children,
  acceptedLabel,
  onAccept,
  onAlternatives,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  | "state"
  | "question"
  | "children"
  | "acceptedLabel"
  | "onAccept"
  | "onAlternatives"
> & {
  state: RecommendationState;
  question: string;
  children: ReactNode;
  acceptedLabel: string;
  onAccept?: () => void;
  onAlternatives?: () => void;
}) {
  const { receiptRef, focusHandlers } = useReceiptFocus<HTMLDivElement>(props);
  return (
    <div
      data-slot="recommendation-card"
      className={cn(
        paper,
        "flex w-full max-w-sm flex-col gap-3 rounded-[20px] p-4",
        className,
      )}
      {...props}
      {...focusHandlers}
    >
      <p className="text-sm font-medium">{question}</p>
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        {children}
      </p>

      <div className="flex h-8 items-center justify-between">
        {state === "idle" ? (
          <>
            <div className="ms-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onAlternatives}
                className="text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/90 h-8 rounded-full px-3.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
              >
                Alternatives
              </button>
              <button
                type="button"
                onClick={onAccept}
                className={cn(
                  inkButton,
                  "flex h-8 items-center rounded-full px-3.5 text-xs font-medium",
                )}
              >
                Accept
              </button>
            </div>
          </>
        ) : (
          <div
            key="accepted"
            ref={receiptRef}
            tabIndex={-1}
            className="fade-in animate-in text-muted-foreground flex items-center gap-2 text-xs duration-300"
          >
            <CheckIcon className="size-3.5 text-emerald-500" />
            {acceptedLabel}
          </div>
        )}
      </div>
    </div>
  );
}
