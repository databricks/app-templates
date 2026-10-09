import { createHash } from 'node:crypto';
import { ApiError, createApp, files } from '@databricks/appkit';
import { isOutputFilePath } from '../shared/fileOutputs';
import { denyDiscoveredVolumes, encodeStoragePath, parseStorageFileSize, setupStorageVolume } from './storageVolume';

export interface OutputFileStore {
  size(path: string): Promise<number | undefined>;
  download(path: string): Promise<ReadableStream<Uint8Array>>;
}

async function createOutputVolume(volume: string) {
  return setupStorageVolume(async () => {
    // AppKit discovers roots via env. A unique immutable key prevents parallel handles for
    // different volumes (including uploads) from racing over a shared env binding.
    const key = `output_${createHash('sha256').update(volume).digest('hex')}`;
    process.env[`DATABRICKS_VOLUME_${key.toUpperCase()}`] = `/Volumes/${volume.replaceAll('.', '/')}`;
    // AppKit 0.70's static manifest still requires this default binding even with named volumes.
    // It is never used by the output store and has a deny-all policy in this instance.
    process.env.DATABRICKS_VOLUME_FILES ??= `/Volumes/${volume.replaceAll('.', '/')}`;
    const appkit = await createApp({
      plugins: [
        files({
          volumes: {
            ...denyDiscoveredVolumes(),
            [key]: {
              auth: 'service-principal',
              policy: (action, resource, user) =>
                user.isServicePrincipal === true &&
                (action === 'download' || action === 'metadata') &&
                isOutputFilePath(resource.path, { volumes: [volume] }),
            },
          },
        }),
      ],
    });
    return appkit.files(key);
  });
}

const handles = new Map<string, ReturnType<typeof createOutputVolume>>();

export function appKitOutputFileStore(volume: string): OutputFileStore {
  const handleForVolume = () => {
    let handle = handles.get(volume);
    if (!handle) {
      handle = createOutputVolume(volume).catch((error) => {
        handles.delete(volume);
        throw error;
      });
      handles.set(volume, handle);
    }
    return handle;
  };
  return {
    async size(path) {
      if (!isOutputFilePath(path, { volumes: [volume] })) throw new Error('Invalid output file destination.');
      try {
        return parseStorageFileSize((await (await handleForVolume()).metadata(encodeStoragePath(path))).contentLength);
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 404) return undefined;
        throw error;
      }
    },
    async download(path) {
      if (!isOutputFilePath(path, { volumes: [volume] })) throw new Error('Invalid output file destination.');
      const result = await (await handleForVolume()).download(encodeStoragePath(path));
      if (!result.contents) throw new Error('The output file has no readable contents.');
      return result.contents;
    },
  };
}
