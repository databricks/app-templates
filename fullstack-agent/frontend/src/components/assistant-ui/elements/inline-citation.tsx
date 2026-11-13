"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface Source {
  title: string;
  snippet: string;
}

/** Numbered source marker that opens on press for accessibility. */
export function Citation({
  index,
  source,
  className,
}: {
  index: number;
  source: Source;
  className?: string | undefined;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Source ${index + 1}: ${source.title}`}
        className={cn(
          "bg-foreground/[0.06] text-muted-foreground hover:text-foreground/90 data-[state=open]:bg-foreground data-[state=open]:text-background focus-visible:ring-ring/50 ms-0.5 inline-flex h-4 min-w-4 translate-y-[-2px] items-center justify-center rounded-[5px] px-1 align-middle font-mono text-[10px] font-medium tabular-nums outline-none transition-colors focus-visible:ring-[3px] motion-reduce:transition-none",
          className,
        )}
      >
        {index + 1}
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={8} aria-label={`Source ${index + 1}`} className="w-64 rounded-2xl p-3.5">
        <p className="text-[13px] leading-snug font-medium">{source.title}</p>
        <p className="text-foreground mt-1 text-[13px] leading-relaxed">{source.snippet}</p>
      </PopoverContent>
    </Popover>
  );
}
