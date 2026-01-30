import { useState, useCallback, type ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { PDFPreviewSheet } from './PDFPreviewSheet';
import type { UCPDFMetadata } from '@/lib/pdf-utils';

export interface PDFCitationLinkProps {
  children: ReactNode;
  pdfMetadata: UCPDFMetadata;
}

export function PDFCitationLink({ children, pdfMetadata }: PDFCitationLinkProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsOpen(true);
  }, []);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClick}
            className="h-auto px-2 py-0 font-medium underline"
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent
          style={{ maxWidth: '350px', padding: '8px', wordWrap: 'break-word' }}
        >
          <div className="space-y-1">
            <div className="font-medium">{pdfMetadata.filename}</div>
            {pdfMetadata.page && (
              <div className="text-muted-foreground text-xs">
                Page {pdfMetadata.page}
              </div>
            )}
            {pdfMetadata.textFragment && (
              <div className='border-muted-foreground/50 border-l-2 pl-2 text-xs italic'>
                "{pdfMetadata.textFragment}"
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>

      <PDFPreviewSheet
        open={isOpen}
        onOpenChange={setIsOpen}
        filename={pdfMetadata.filename}
        volumePath={pdfMetadata.volumePath}
        filePath={pdfMetadata.filePath}
        initialPage={pdfMetadata.page}
        highlightText={pdfMetadata.textFragment}
      />
    </>
  );
}
