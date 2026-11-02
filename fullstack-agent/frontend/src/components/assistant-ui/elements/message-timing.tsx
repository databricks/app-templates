"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { mono } from "./surfaces";

export function MessageTiming({
  label,
  value,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & { label: string; value: string }) {
  return (
    <div
      data-slot="message-timing"
      className={cn(
        "fade-in animate-in flex items-baseline gap-1 duration-500",
        className,
      )}
      {...props}
    >
      <span className={cn(mono, "text-muted-foreground")}>{label}</span>
      <span className={cn(mono, "text-muted-foreground tabular-nums")}>
        {value}
      </span>
    </div>
  );
}
