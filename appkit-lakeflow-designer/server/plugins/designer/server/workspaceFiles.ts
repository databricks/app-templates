import type { WorkspaceClient } from './workspaceClient';
import { isRecord } from '../shared/values';
import { parseStorageFileSize } from './storageVolume';

function fileApiPath(path: string): string {
  return `/api/2.0/fs/files${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function isMissingFile(error: unknown): boolean {
  // Raw requests and typed Files methods expose different SDK error shapes.
  return isRecord(error) && (error.statusCode === 404 || error.httpStatusCode === 404);
}

export async function fileSize(client: WorkspaceClient, path: string): Promise<number | undefined> {
  // The typed getFileMetadata method drops HEAD response headers in SDK 0.89.
  const response = await client.request({ method: 'HEAD', path: fileApiPath(path) });
  return parseStorageFileSize(response.headers.get('content-length') ?? undefined);
}

export async function uploadBytes(client: WorkspaceClient, path: string, bytes: Uint8Array): Promise<void> {
  // In-memory records need Content-Length and a replayable body for transport retries.
  const response = await client.request({
    method: 'PUT',
    path: fileApiPath(path),
    query: { overwrite: 'false' },
    headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
    body: new Uint8Array(bytes),
  });
  await response.body?.cancel();
}

export async function readUploadRecord(client: WorkspaceClient, path: string): Promise<string> {
  const { contents } = await client.files.downloadFile({ filePath: path });
  if (!contents) throw new Error('The upload record has no readable contents.');
  const reader = contents.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array)) throw new Error('The upload record did not contain bytes.');
      bytesRead += chunk.byteLength;
      if (bytesRead > 16 * 1024) throw new Error('The upload record exceeds 16 KiB.');
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
