import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Loader } from '@/components/elements/loader';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type PDFError =
  | { type: 'NotFoundError' }
  | { type: 'PermissionError' }
  | { type: 'LoadError'; message?: string };

export interface PDFViewerProps {
  url: string;
  initialPage?: number;
  onLoadError?: (error: PDFError) => void;
}

export function PDFViewer({ url, initialPage = 1, onLoadError }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [isLoading, setIsLoading] = useState(true);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages);
      setIsLoading(false);
      // Ensure initial page is within bounds
      if (initialPage > numPages) {
        setPageNumber(1);
      }
    },
    [initialPage],
  );

  const onDocumentLoadError = useCallback(
    (error: Error) => {
      setIsLoading(false);
      // Map error to our error type
      const errorMessage = error.message?.toLowerCase() || '';
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        onLoadError?.({ type: 'NotFoundError' });
      } else if (
        errorMessage.includes('403') ||
        errorMessage.includes('forbidden') ||
        errorMessage.includes('permission')
      ) {
        onLoadError?.({ type: 'PermissionError' });
      } else {
        onLoadError?.({ type: 'LoadError', message: error.message });
      }
    },
    [onLoadError],
  );

  const goToPrevPage = useCallback(() => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPageNumber((prev) => Math.min(prev + 1, numPages || prev));
  }, [numPages]);

  return (
    <div className="flex h-full flex-col">
      {/* Page navigation */}
      {numPages && numPages > 1 && (
        <div className="flex items-center justify-center gap-2 border-b bg-muted/50 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrevPage}
            disabled={pageNumber <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className='text-muted-foreground text-sm'>
            Page {pageNumber} of {numPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNextPage}
            disabled={pageNumber >= numPages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* PDF content */}
      <div className="flex flex-1 justify-center overflow-auto bg-muted/30 p-4">
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex h-64 items-center justify-center">
              <Loader size={24} />
            </div>
          }
        >
          {!isLoading && (
            <Page
              pageNumber={pageNumber}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              className="shadow-lg"
              loading={
                <div className="flex h-64 items-center justify-center">
                  <Loader size={24} />
                </div>
              }
            />
          )}
        </Document>
      </div>
    </div>
  );
}
