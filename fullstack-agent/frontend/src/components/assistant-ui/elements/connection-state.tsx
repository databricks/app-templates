"use client";

import type { ComponentProps } from "react";
import { CloudOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { paper } from "./surfaces";

export function ConnectionState({
  onRetry,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "onRetry"> & {
  onRetry: () => void;
}) {
  return (
    <div
      data-slot="connection-state"
      className={cn(
        paper,
        "fade-in slide-in-from-top-1 animate-in flex w-full max-w-sm items-center gap-2.5 rounded-2xl px-3.5 py-2.5 duration-300",
        className,
      )}
      {...props}
    >
      <CloudOffIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 flex-1 text-[13px]">
        Your connection was interrupted. Check your internet connection and try
        again.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground/95 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
      >
        Try again
      </button>
    </div>
  );
}
