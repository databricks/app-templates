"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { mono } from "./surfaces";

export function DaySeparatorHeader({
  day,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & { day: string }) {
  return (
    <div
      data-slot="day-separator-header"
      className={cn("flex items-center gap-2.5 py-1", className)}
      {...props}
    >
      <span className="bg-foreground/[0.08] h-px flex-1" />
      <span className={cn(mono, "text-muted-foreground")}>{day}</span>
      <span className="bg-foreground/[0.08] h-px flex-1" />
    </div>
  );
}
