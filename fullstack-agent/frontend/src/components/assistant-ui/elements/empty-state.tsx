"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex w-full max-w-md flex-col items-center gap-7",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyStateGreeting({
  className,
  ...props
}: ComponentProps<"h2">) {
  return (
    <h2
      data-slot="empty-state-greeting"
      className={cn(
        "fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-center text-2xl font-medium tracking-tight duration-500 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyStateSuggestions({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-state-suggestions"
      className={cn("flex flex-wrap justify-center gap-2", className)}
      {...props}
    />
  );
}
