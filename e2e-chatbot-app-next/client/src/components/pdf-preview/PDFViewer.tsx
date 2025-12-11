import { useState, useCallback, useEffect, useRef } from 'react';
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
  highlightText?: string;
  onLoadError?: (error: PDFError) => void;
}

/**
 * Highlight text in the PDF text layer by searching for phrases
 * and wrapping matching text nodes with highlight spans.
 */
function highlightTextInPage(
  container: HTMLElement,
  searchPhrases: string[],
): void {
  const textLayer = container.querySelector('.react-pdf__Page__textContent');
  if (!textLayer) return;

  // Get all text spans in the text layer
  const textSpans = textLayer.querySelectorAll('span');
  if (textSpans.length === 0) return;

  // Build the full text content and track positions
  let fullText = '';
  const spanMap: { start: number; end: number; span: HTMLSpanElement }[] = [];

  textSpans.forEach((span) => {
    const start = fullText.length;
    const text = span.textContent || '';
    fullText += text;
    spanMap.push({ start, end: start + text.length, span });
  });

  // Normalize text for matching (collapse whitespace)
  const normalizedFullText = fullText.toLowerCase();

  // Find matches for each phrase
  for (const phrase of searchPhrases) {
    const normalizedPhrase = phrase.toLowerCase().trim();
    if (normalizedPhrase.length < 3) continue;

    let searchStart = 0;
    let matchIndex: number;

    while (
      (matchIndex = normalizedFullText.indexOf(normalizedPhrase, searchStart)) !==
      -1
    ) {
      const matchEnd = matchIndex + normalizedPhrase.length;

      // Find spans that contain this match
      for (const { start, end, span } of spanMap) {
        // Check if this span overlaps with the match
        if (start < matchEnd && end > matchIndex) {
          // Add highlight class to the span
          span.classList.add('pdf-text-highlight');
        }
      }

      searchStart = matchIndex + 1;
    }
  }
}

export function PDFViewer({
  url,
  initialPage = 1,
  highlightText,
  onLoadError,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [pageRendered, setPageRendered] = useState(false);
  const pageContainerRef = useRef<HTMLDivElement>(null);

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

  const onPageRenderSuccess = useCallback(() => {
    setPageRendered(true);
  }, []);

  // Reset pageRendered when page changes
  useEffect(() => {
    setPageRendered(false);
  }, [pageNumber]);

  // Apply text highlighting after page renders - only on the initial page
  useEffect(() => {
    if (!pageRendered || !highlightText || !pageContainerRef.current) return;

    // Only highlight on the initial page (the one from the citation)
    if (pageNumber !== initialPage) {
      console.log(
        '[PDFViewer] Skipping highlight - not on initial page. Current:',
        pageNumber,
        'Initial:',
        initialPage,
      );
      return;
    }

    // Extract phrases from highlight text
    const phrases = highlightText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3);

    console.log('[PDFViewer] Highlighting on page', pageNumber, 'phrases:', phrases);

    if (phrases.length > 0) {
      // Small delay to ensure text layer is fully rendered
      const timeoutId = setTimeout(() => {
        if (pageContainerRef.current) {
          highlightTextInPage(pageContainerRef.current, phrases);
        }
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [pageRendered, highlightText, pageNumber, initialPage]);

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
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-zinc-900 p-4"
      >
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
          <div ref={pageContainerRef}>
            <Page
              pageNumber={pageNumber}
              width={containerWidth ? containerWidth - 32 : undefined}
              onRenderSuccess={onPageRenderSuccess}
              loading={
                <div className="flex h-96 items-center justify-center">
                  <Loader size={24} />
                </div>
              }
              className="shadow-lg"
            />
          </div>
        </Document>
      </div>
    </div>
  );
}
