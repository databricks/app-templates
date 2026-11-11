import type { WorkspaceClient } from './workspaceClient';
import { fileSize, isMissingFile, readUploadRecord, uploadBytes } from './workspaceFiles';
import type { AppStorage } from '../shared/storageConfig';
import { UPLOAD_UNAVAILABLE, UPLOAD_UNAVAILABLE_MESSAGE } from '../shared/storageConfig';
import { uploadStoragePath } from '../shared/storageConfig';
import { UploadError, type UploadStore } from './fileUploads';

export function createUploadStore(client: WorkspaceClient, config: AppStorage | undefined): UploadStore {
  const access = async <T>(path: string, operation: () => Promise<T>): Promise<T> => {
    try {
      if (!config) throw new UploadError(409, 'File uploads are not configured.');
      if (!path.startsWith(`${uploadStoragePath(config)}/`)) throw new Error('Invalid upload storage destination.');
      return await operation();
    } catch (error) {
      if (error instanceof UploadError) throw error;
      const missing = isMissingFile(error);
      throw new UploadError(
        missing ? 404 : 502,
        missing
          ? UPLOAD_UNAVAILABLE_MESSAGE
          : 'Could not access upload storage. Check the app volume resource and permissions.',
        { cause: error, ...(missing ? { code: UPLOAD_UNAVAILABLE } : {}) }
      );
    }
  };
  return {
    mkdir: (path) =>
      access(path, async () => {
        await client.files.createDirectory({ directoryPath: path });
      }),
    put: (path, bytes) => access(path, () => uploadBytes(client, path, bytes)),
    putStream: (path, stream) =>
      access(path, async () => {
        await client.files.uploadFile({ filePath: path, contents: stream, overwrite: false });
      }),
    read: (path) =>
      access(path, async () => {
        const contents = await readUploadRecord(client, path);
        try {
          const record: unknown = JSON.parse(contents);
          return record;
        } catch {
          throw new UploadError(409, 'The upload record is unreadable.');
        }
      }),
    download: (path) =>
      access(path, async () => {
        const result = await client.files.downloadFile({ filePath: path });
        if (!result.contents) throw new UploadError(502, 'The uploaded file has no readable contents.');
        return result.contents;
      }),
    size: (path) =>
      access(path, async () => {
        return fileSize(client, path);
      }),
    delete: (path) =>
      access(path, async () => {
        await client.files.deleteFile({ filePath: path });
      }),
  };
}
