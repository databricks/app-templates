"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { floating, mono } from "./surfaces";

export interface RegenerateOption {
  id: string;
  label: string;
  detail: string;
}

export function RegenerateMenu({
  options,
  currentId,
  onPick,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "options" | "currentId" | "onPick"> & {
  options: readonly RegenerateOption[];
  currentId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div data-slot="regenerate-menu" className={cn("flex w-full max-w-sm flex-col gap-2", className)} {...props}>
      <div
        className={cn(
          floating,
          "fade-in zoom-in-95 slide-in-from-top-1 animate-in flex flex-col gap-0.5 rounded-2xl p-1.5 duration-200",
        )}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPick(option.id)}
            className="hover:bg-foreground/[0.05] flex items-baseline gap-2 rounded-xl px-2.5 py-1.5 text-start transition-colors"
          >
            <span className="min-w-0 flex-1 truncate text-[13px]">{option.label}</span>
            <span className={cn(mono, "text-muted-foreground shrink-0")}>
              {option.id === currentId ? "current" : option.detail}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
