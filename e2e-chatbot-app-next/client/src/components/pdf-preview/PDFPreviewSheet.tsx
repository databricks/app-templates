import {
  useReducer,
  useState,
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
import { isPDFError, } from '@/lib/pdf-errors';
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

// State machine for PDF loading
type LoadingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; blobUrl: string }
  | { status: 'error'; error: PDFError };

type LoadingAction =
  | { type: 'START_LOADING' }
  | { type: 'LOAD_SUCCESS'; blobUrl: string }
  | { type: 'LOAD_ERROR'; error: PDFError }
  | { type: 'RETRY' }
  | { type: 'RESET' };

function loadingReducer(state: LoadingState, action: LoadingAction): LoadingState {
  switch (action.type) {
    case 'START_LOADING':
      return { status: 'loading' };
    case 'LOAD_SUCCESS':
      return { status: 'success', blobUrl: action.blobUrl };
    case 'LOAD_ERROR':
      return { status: 'error', error: action.error };
    case 'RETRY':
      return { status: 'loading' };
    case 'RESET':
      return { status: 'idle' };
    default:
      return state;
  }
}

const initialLoadingState: LoadingState = { status: 'idle' };

// Resize constraints
const MIN_WIDTH = 400;
const MAX_WIDTH_PERCENT = 95;
const DEFAULT_WIDTH_PERCENT = 85;

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
  const [loadingState, dispatch] = useReducer(loadingReducer, initialLoadingState);
  const [retryCount, setRetryCount] = useState(0);
  const [showCitedText, setShowCitedText] = useState(true);
  const { workspaceUrl } = useAppConfig();

  // Resize state
  const [width, setWidth] = useState(() =>
    Math.round((window.innerWidth * DEFAULT_WIDTH_PERCENT) / 100)
  );
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Ref to track blob URL for cleanup (avoids dependency issues with useEffect)
  const blobUrlRef = useRef<string | null>(null);

  // Derive values from state for easier access
  const isLoading = loadingState.status === 'loading';
  const error = loadingState.status === 'error' ? loadingState.error : null;
  const blobUrl = loadingState.status === 'success' ? loadingState.blobUrl : null;

  // Keep ref in sync with state
  useEffect(() => {
    blobUrlRef.current = blobUrl;
  }, [blobUrl]);

  const ucExplorerUrl = getUnityCatalogExplorerUrl(
    volumePath,
    filename,
    workspaceUrl,
  );

  // Fetch the PDF when the sheet opens or retryCount changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryCount is intentionally used to trigger re-fetches
  useEffect(() => {
    if (!open || !filePath) return;

    let cancelled = false;

    const loadPdf = async () => {
      // Cleanup previous blob URL before starting new load
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      dispatch({ type: 'START_LOADING' });

      try {
        const url = await fetchDatabricksFile(filePath);
        if (!cancelled) {
          dispatch({ type: 'LOAD_SUCCESS', blobUrl: url });
        } else {
          // Clean up if cancelled
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        if (!cancelled) {
          if (isPDFError(err)) {
            dispatch({ type: 'LOAD_ERROR', error: { type: err.type, message: err.message } });
          } else {
            dispatch({
              type: 'LOAD_ERROR',
              error: {
                type: 'LoadError',
                message: err instanceof Error ? err.message : 'Unknown error',
              },
            });
          }
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
    };
    // retryCount is intentionally included to trigger re-fetches on retry
  }, [open, filePath, retryCount]);

  const handleLoadError = useCallback((err: PDFError) => {
    dispatch({ type: 'LOAD_ERROR', error: err });
  }, []);

  const handleRetry = useCallback(() => {
    // Cleanup is handled in the useEffect when retryCount changes
    dispatch({ type: 'RETRY' });
    setRetryCount((prev) => prev + 1);
  }, []);

  // Reset state and cleanup blob URL when sheet closes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        // Cleanup blob URL via ref
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
        dispatch({ type: 'RESET' });
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

  // Resize handlers
  const handleResizeStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = width;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [width]);

  const handleResizeMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isResizing) return;

      // Calculate new width (dragging left edge, so subtract delta)
      const delta = resizeStartX.current - e.clientX;
      const newWidth = resizeStartWidth.current + delta;

      // Apply constraints
      const maxWidth = Math.round((window.innerWidth * MAX_WIDTH_PERCENT) / 100);
      const clampedWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));

      setWidth(clampedWidth);
    },
    [isResizing]
  );

  const handleResizeEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    setIsResizing(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className="flex flex-col gap-0 p-0 sm:max-w-none"
        style={{ width: `${width}px` }}
        side="right"
      >
        {/* Resize handle */}
        <div
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          className={`absolute top-0 left-0 h-full w-1.5 cursor-ew-resize bg-transparent transition-colors hover:bg-primary/20 ${
            isResizing ? 'bg-primary/30' : ''
          }`}
        />
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
              key={retryCount}
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
