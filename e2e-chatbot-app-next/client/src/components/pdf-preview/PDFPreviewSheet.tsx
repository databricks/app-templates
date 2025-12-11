import { useState, useCallback, useEffect } from 'react';
import {
  Download,
  ExternalLink,
  FileWarning,
  Lock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Quote,
} from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/elements/loader';
import { PDFViewer, type PDFError } from './PDFViewer';
import {
  getUnityCatalogExplorerUrl,
  fetchDatabricksFile,
} from '@/lib/pdf-utils';
import { useAppConfig } from '@/contexts/AppConfigContext';

export interface PDFPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  volumePath: string;
  /** Full path for the UC file (Volumes/catalog/schema/volume/filename.pdf) */
  filePath: string;
  initialPage?: number;
  highlightText?: string;
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
  filePath,
  initialPage,
  highlightText,
}: PDFPreviewSheetProps) {
  const [error, setError] = useState<PDFError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showCitedText, setShowCitedText] = useState(true);
  const { workspaceUrl } = useAppConfig();

  const ucExplorerUrl = getUnityCatalogExplorerUrl(
    volumePath,
    filename,
    workspaceUrl,
  );

  // Fetch the PDF when the sheet opens
  useEffect(() => {
    if (!open || !filePath) return;

    let cancelled = false;
    const currentBlobUrl = blobUrl;

    const loadPdf = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const url = await fetchDatabricksFile(filePath);
        if (!cancelled) {
          setBlobUrl(url);
        } else {
          // Clean up if cancelled
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message.toLowerCase() : '';
          if (message.includes('404')) {
            setError({ type: 'NotFoundError' });
          } else if (message.includes('403')) {
            setError({ type: 'PermissionError' });
          } else {
            setError({
              type: 'LoadError',
              message: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      // Revoke old blob URL on cleanup
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
    };
  }, [open, filePath, retryKey]);

  // Cleanup blob URL when component unmounts or sheet closes
  useEffect(() => {
    if (!open && blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
  }, [open, blobUrl]);

  const handleLoadError = useCallback((err: PDFError) => {
    setError(err);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setBlobUrl(null);
    setRetryKey((prev) => prev + 1);
  }, []);

  // Reset state when sheet closes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setError(null);
      }
      onOpenChange(isOpen);
    },
    [onOpenChange],
  );

  // Handle download via POST request
  const handleDownload = useCallback(async () => {
    try {
      const url = blobUrl || (await fetchDatabricksFile(filePath));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (!blobUrl) {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, [blobUrl, filePath, filename]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className="flex w-[70vw] max-w-4xl flex-col gap-0 p-0 sm:max-w-4xl"
        side="right"
      >
        <SheetHeader className="space-y-0 border-b px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <SheetTitle className="truncate">{filename}</SheetTitle>
            <div className="flex shrink-0 items-center gap-2 pr-8">
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
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </div>

          {/* Cited text section */}
          {highlightText && (
            <div className="mt-3 border-t pt-3">
              <button
                type="button"
                onClick={() => setShowCitedText(!showCitedText)}
                className="flex w-full items-center gap-2 text-left text-muted-foreground text-sm hover:text-foreground"
              >
                <Quote className="h-4 w-4 shrink-0" />
                <span className="font-medium">
                  Cited text{initialPage ? ` (page ${initialPage})` : ''}
                </span>
                {showCitedText ? (
                  <ChevronUp className="ml-auto h-4 w-4 shrink-0" />
                ) : (
                  <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
                )}
              </button>
              {showCitedText && (
                <div className="mt-2 rounded-md bg-muted/50 p-3 text-sm">
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {highlightText}
                  </p>
                </div>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader size={24} />
            </div>
          ) : error ? (
            <PDFErrorState
              error={error}
              filename={filename}
              onRetry={handleRetry}
            />
          ) : blobUrl ? (
            <PDFViewer
              key={retryKey}
              url={blobUrl}
              initialPage={initialPage}
              onLoadError={handleLoadError}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
