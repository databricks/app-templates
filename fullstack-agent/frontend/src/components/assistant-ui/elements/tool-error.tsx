"use client";

import type { ComponentProps } from "react";
import { AlertCircleIcon, RotateCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { field, mono, paper } from "./surfaces";

export function ToolError({
  name,
  message,
  onRetry,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "name" | "message" | "onRetry"> & {
  name: string;
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div
      data-slot="tool-error"
      className={cn(
        paper,
        "flex w-full max-w-sm flex-col gap-3 rounded-2xl p-3.5",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <AlertCircleIcon className="size-3.5 shrink-0 text-red-500" />
        <span
          className={cn(mono, "text-muted-foreground min-w-0 wrap-anywhere")}
        >
          {name}
        </span>
      </div>

      <div
        className={cn(
          field,
          "rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed break-words text-red-700 dark:text-red-300",
        )}
      >
        {message}
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground/95 flex h-7 items-center gap-1.5 self-end rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
        >
          <RotateCwIcon className="size-3" />
          Retry
        </button>
      )}
    </div>
  );
}
