export function parseStorageFileSize(contentLength: unknown): number | undefined {
  const size = Number(contentLength);
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}
