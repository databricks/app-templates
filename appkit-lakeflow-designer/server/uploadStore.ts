import { ApiError } from '@databricks/appkit';
import type { AppStorage } from '../shared/storageConfig';
import { UPLOAD_UNAVAILABLE, UPLOAD_UNAVAILABLE_MESSAGE } from '../shared/storageConfig';
import { UploadError, type UploadStore } from './fileUploads';
import { createUploadVolume, encodeStoragePath, parseStorageFileSize } from './storageVolume';

let cachedVolume: { volume: string; path: string; promise: ReturnType<typeof createUploadVolume> } | undefined;

async function uploadVolume(config: AppStorage | undefined) {
  if (!config) throw new UploadError(409, 'File uploads are not configured.');
  if (!cachedVolume || cachedVolume.volume !== config.volume || cachedVolume.path !== config.path) {
    // Keep each policy bound to its request's manifest while republishing changes the prefix.
    const promise = createUploadVolume(config).catch((error) => {
      if (cachedVolume?.promise === promise) cachedVolume = undefined;
      throw error;
    });
    cachedVolume = { volume: config.volume, path: config.path, promise };
  }
  return cachedVolume.promise;
}

export function appKitUploadStore(config: AppStorage | undefined): UploadStore {
  const access = async <T>(operation: (volume: Awaited<ReturnType<typeof uploadVolume>>) => Promise<T>): Promise<T> => {
    try {
      return await operation(await uploadVolume(config));
    } catch (error) {
      if (error instanceof UploadError) throw error;
      const missing = error instanceof ApiError && error.statusCode === 404;
      throw new UploadError(
        missing ? 404 : 502,
        missing
          ? UPLOAD_UNAVAILABLE_MESSAGE
          : 'Could not access upload storage. Check the app volume resource and permissions.',
        { cause: error, ...(missing ? { code: UPLOAD_UNAVAILABLE } : {}) },
      );
    }
  };
  return {
    mkdir: (path) => access((volume) => volume.createDirectory(encodeStoragePath(path))),
    put: (path, bytes) => access((volume) => volume.upload(encodeStoragePath(path), Buffer.from(bytes), { overwrite: false })),
    putStream: (path, stream) => access((volume) => volume.upload(encodeStoragePath(path), stream, { overwrite: false })),
    read: (path) =>
      access(async (volume) => {
        const contents = await volume.read(encodeStoragePath(path), { maxSize: 16 * 1024 });
        try {
          return JSON.parse(contents);
        } catch {
          throw new UploadError(409, 'The upload record is unreadable.');
        }
      }),
    size: (path) =>
      access(async (volume) => {
        const metadata = await volume.metadata(encodeStoragePath(path));
        return parseStorageFileSize(metadata.contentLength);
      }),
    delete: (path) => access((volume) => volume.delete(encodeStoragePath(path))),
  };
}
