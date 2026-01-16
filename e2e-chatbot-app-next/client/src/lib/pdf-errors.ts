/**
 * Typed errors for PDF operations.
 * These errors are thrown by fetchDatabricksFile and caught by PDF components.
 */

export class PDFNotFoundError extends Error {
  readonly type = 'NotFoundError' as const;

  constructor(message = 'File not found') {
    super(message);
    this.name = 'PDFNotFoundError';
  }
}

export class PDFPermissionError extends Error {
  readonly type = 'PermissionError' as const;

  constructor(message = 'Permission denied') {
    super(message);
    this.name = 'PDFPermissionError';
  }
}

export class PDFLoadError extends Error {
  readonly type = 'LoadError' as const;

  constructor(message = 'Failed to load PDF') {
    super(message);
    this.name = 'PDFLoadError';
  }
}

export type PDFError = PDFNotFoundError | PDFPermissionError | PDFLoadError;

export function isPDFError(error: unknown): error is PDFError {
  return (
    error instanceof PDFNotFoundError ||
    error instanceof PDFPermissionError ||
    error instanceof PDFLoadError
  );
}
