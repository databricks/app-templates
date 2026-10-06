export interface AppStorage {
  volume: string;
  path: string;
  maxUploadFileSizeBytes: number;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_LABEL = '5 GB';
export const UPLOAD_UNAVAILABLE = 'UPLOAD_UNAVAILABLE';
export const UPLOAD_UNAVAILABLE_MESSAGE = 'This upload is no longer available. Upload the file again.';
export const UPLOAD_REFERENCE = /^upload:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export const uploadStoragePath = (storage: AppStorage): string => `${storage.path}/uploads`;

export function parseAppStorage(value: unknown): AppStorage | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('volume' in value) ||
    !('path' in value) ||
    !('maxUploadFileSizeBytes' in value)
  )
    return undefined;
  if (typeof value.volume !== 'string' || typeof value.path !== 'string') return undefined;
  const names = value.volume.split('.');
  if (names.length !== 3 || !names.every((name) => /^[A-Za-z0-9_-]+$/.test(name))) return undefined;
  const root = `/Volumes/${names.join('/')}`;
  const prefix = `${root}/designer_apps/`;
  if (!value.path.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(value.path.slice(prefix.length)))
    return undefined;
  if (
    typeof value.maxUploadFileSizeBytes !== 'number' ||
    !Number.isSafeInteger(value.maxUploadFileSizeBytes) ||
    value.maxUploadFileSizeBytes <= 0 ||
    value.maxUploadFileSizeBytes > MAX_UPLOAD_BYTES
  )
    return undefined;
  return { volume: value.volume, path: value.path, maxUploadFileSizeBytes: value.maxUploadFileSizeBytes };
}
