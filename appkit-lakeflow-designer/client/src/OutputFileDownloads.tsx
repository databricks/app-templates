import { useState } from 'react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@databricks/appkit-ui/react';

import { fileDownloadRoute, type WrittenFile } from '../../shared/fileOutputs';

const filenameFor = (file: WrittenFile) => file.path.slice(file.path.lastIndexOf('/') + 1);

export function OutputFileDownloads({
  files,
  runId,
  outputId,
  outputTitle,
}: {
  files: WrittenFile[];
  runId: string;
  outputId: string;
  outputTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>();
  const selectedIndex = Math.max(0, files.findIndex((file) => file.path === selectedPath));
  const selectedFile = files[selectedIndex];
  if (selectedFile === undefined) return null;
  const filename = filenameFor(selectedFile);
  const href = fileDownloadRoute(runId, outputId, selectedIndex);

  if (files.length === 1) {
    return (
      <a className="text-foreground break-all underline underline-offset-2" href={href} aria-label={`Download ${filename}`}>
        {filename}
      </a>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:max-w-xl">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={`Select file for ${outputTitle}: ${filename}`}
            title={filename}
            className="w-full min-w-0 justify-between"
          >
            <span className="truncate">{filename}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[max(20rem,var(--radix-popover-trigger-width))] max-w-[var(--radix-popover-content-available-width)] p-0">
          <Command label={`Files for ${outputTitle}`} defaultValue={String(selectedIndex)}>
            <CommandInput placeholder="Search files…" aria-label="Search generated files" />
            <CommandList>
              <CommandEmpty>No matching files.</CommandEmpty>
              <CommandGroup>
                {files.map((file, index) => (
                  <CommandItem
                    key={index}
                    value={String(index)}
                    keywords={[filenameFor(file)]}
                    onSelect={() => {
                      setSelectedPath(file.path);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate" title={filenameFor(file)}>{filenameFor(file)}</span>
                    {index === selectedIndex ? <span className="text-muted-foreground ml-auto shrink-0 text-xs">Selected</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button variant="secondary" className="shrink-0" asChild>
        <a href={href} aria-label={`Download ${filename}`}>Download</a>
      </Button>
    </div>
  );
}
