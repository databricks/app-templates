"use client";

import type { ComponentProps } from "react";
import { ArrowRightIcon, SquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { field, mono } from "./surfaces";

export function StoppedRun({
  reason,
  onContinue,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "reason" | "onContinue"> & {
  reason: string;
  onContinue: () => void;
}) {
  return (
    <div
      data-slot="stopped-run"
      className={cn("flex w-full max-w-sm items-center gap-2", className)}
      {...props}
    >
      <span
        className={cn(
          field,
          mono,
          "text-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
        )}
      >
        <SquareIcon className="size-2.5 fill-current" />
        {reason}
      </span>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onContinue}
        className="text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground/95 ms-auto flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
      >
        Continue
        <ArrowRightIcon className="size-3" />
      </button>
    </div>
  );
}
