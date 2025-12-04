import { useState, useCallback } from 'react';
import { Download, ExternalLink, FileWarning, Lock, AlertCircle } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { PDFViewer, type PDFError } from './PDFViewer';
import { getUnityCatalogExplorerUrl } from '@/lib/pdf-utils';

export interface PDFPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  volumePath: string;
  downloadUrl: string;
  initialPage?: number;
}

function PDFErrorState({
  error,
  filename,
  onRetry,
}: {
  error: PDFError;
  filename: string;
  onRetry: () => void;
}) {
  const getErrorContent = () => {
    switch (error.type) {
      case 'NotFoundError':
        return {
          icon: <FileWarning className="h-12 w-12 text-muted-foreground" />,
          title: 'File not found',
          description: `We could not find the file "${filename}". Please check if the file was moved, renamed, or deleted.`,
        };
      case 'PermissionError':
        return {
          icon: <Lock className="h-12 w-12 text-muted-foreground" />,
          title: "You can't access this file",
          description: `You do not have permission to access "${filename}". Please contact an administrator.`,
        };
      case 'LoadError':
      default:
        return {
          icon: <AlertCircle className="h-12 w-12 text-destructive" />,
          title: 'Failed to load PDF',
          description:
            error.type === 'LoadError' && error.message
              ? error.message
              : 'An unexpected error occurred while loading the PDF file.',
        };
    }
  };

  const { icon, title, description } = getErrorContent();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      {icon}
      <div className="space-y-2">
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="max-w-md text-muted-foreground text-sm">{description}</p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function PDFPreviewSheet({
  open,
  onOpenChange,
  filename,
  volumePath,
  downloadUrl,
  initialPage,
}: PDFPreviewSheetProps) {
  const [error, setError] = useState<PDFError | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const ucExplorerUrl = getUnityCatalogExplorerUrl(volumePath, filename);

  const handleLoadError = useCallback((err: PDFError) => {
    setError(err);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setRetryKey((prev) => prev + 1);
  }, []);

  // Reset error state when sheet closes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setError(null);
      }
      onOpenChange(isOpen);
    },
    [onOpenChange],
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className="flex w-[70vw] max-w-4xl flex-col gap-0 p-0 sm:max-w-4xl"
        side="right"
      >
        <SheetHeader className="flex-row items-center justify-between gap-4 border-b px-4 py-3">
          <SheetTitle className="truncate">{filename}</SheetTitle>
          <div className="flex shrink-0 items-center gap-2">
            {ucExplorerUrl && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={ucExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open in Catalog
                </a>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <a href={downloadUrl} download={filename}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-hidden">
          {error ? (
            <PDFErrorState
              error={error}
              filename={filename}
              onRetry={handleRetry}
            />
          ) : (
            <PDFViewer
              key={retryKey}
              url={downloadUrl}
              initialPage={initialPage}
              onLoadError={handleLoadError}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
