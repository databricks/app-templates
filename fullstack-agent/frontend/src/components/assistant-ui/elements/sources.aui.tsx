"use client";

import { memo } from "react";
import { FileTextIcon } from "lucide-react";
import type { SourceMessagePartComponent } from "@assistant-ui/react";
import { Badge } from "@/components/ui/badge";

const SourcesImpl: SourceMessagePartComponent = (part) => {
  if (part.sourceType !== "document") return null;
  return (
    <Badge variant="secondary">
      <span data-slot="source" className="inline-flex items-center gap-1.5">
        <FileTextIcon className="text-muted-foreground size-3 shrink-0" />
        <span data-slot="source-title" className="max-w-37.5 truncate">
          {part.title}
        </span>
      </span>
    </Badge>
  );
};

/** A source of the answer as a chip: a document the run read, by its title. */
export const Sources = memo(SourcesImpl);
