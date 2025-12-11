import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/elements/loader';

// Configure PDF.js worker - bundled with the application
pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';

export type PDFError =
  | { type: 'NotFoundError' }
  | { type: 'PermissionError' }
  | { type: 'LoadError'; message?: string };

export interface PDFViewerProps {
  url: string;
  initialPage?: number;
  onLoadError?: (error: PDFError) => void;
}

export function PDFViewer({
  url,
  initialPage = 1,
  onLoadError,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages);
      // Ensure initialPage is within bounds
      if (initialPage > numPages) {
        setPageNumber(numPages);
      } else if (initialPage < 1) {
        setPageNumber(1);
      }
    },
    [initialPage],
  );

  const onDocumentLoadError = useCallback(
    (error: Error) => {
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

  // Measure container width for responsive PDF scaling
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      resizeObserver.observe(node);
      // Set initial width
      setContainerWidth(node.clientWidth);
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Navigation controls */}
      <div className="flex items-center justify-center gap-4 border-b bg-muted/50 px-4 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={goToPrevPage}
          disabled={pageNumber <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">
          Page {pageNumber} of {numPages || '...'}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={goToNextPage}
          disabled={pageNumber >= (numPages || 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* PDF content */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-zinc-900 p-4">
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex h-full items-center justify-center">
              <Loader size={24} />
            </div>
          }
          className="flex flex-col items-center"
        >
          <Page
            pageNumber={pageNumber}
            width={containerWidth ? containerWidth - 32 : undefined}
            loading={
              <div className="flex h-96 items-center justify-center">
                <Loader size={24} />
              </div>
            }
            className="shadow-lg"
          />
        </Document>
      </div>
    </div>
  );
}
