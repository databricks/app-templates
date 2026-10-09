import { useRef, useState, type DragEvent } from 'react';
import { Button, cn, formatFileSize, Input } from '@databricks/appkit-ui/react';
import { uploadAccept } from '../../shared/fileFormats';

export interface FileParameterControlProps {
  name: string;
  fileFormats?: string[];
  file: File | undefined;
  error: string | undefined;
  onFileChange: (file: File) => void;
  disabled: boolean;
}

export function FileParameterControl({
  name, fileFormats, file, error, onFileChange, disabled,
}: FileParameterControlProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const errorId = `${name}-upload-error`;

  const stageDroppedFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) {
      const dropped = event.dataTransfer.files[0];
      if (dropped !== undefined) onFileChange(dropped);
    }
  };

  return (
    <div className="grid gap-1.5">
      <div
        className={cn(
          'border-input flex min-h-14 items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 transition-colors',
          dragging && 'border-ring bg-accent',
          disabled && 'cursor-not-allowed'
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget;
          if (!(related instanceof Node) || !event.currentTarget.contains(related)) setDragging(false);
        }}
        onDrop={stageDroppedFile}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{file?.name ?? 'Drop a file here'}</p>
          {file === undefined ? null : <p className="text-muted-foreground text-xs">{formatFileSize(file.size)}</p>}
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0" disabled={disabled} onClick={() => input.current?.click()}>
          {file === undefined ? 'Choose file' : 'Replace'}
        </Button>
        <Input
          ref={input}
          id={name}
          type="file"
          accept={uploadAccept(fileFormats)}
          className="sr-only"
          disabled={disabled}
          aria-describedby={error === undefined ? undefined : errorId}
          aria-invalid={error !== undefined}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected !== undefined) onFileChange(selected);
            event.target.value = '';
          }}
        />
      </div>
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
