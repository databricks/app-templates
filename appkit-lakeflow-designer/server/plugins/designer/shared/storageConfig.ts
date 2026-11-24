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

const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

export function isVolumeName(volume: string): boolean {
  const names = volume.split('.');
  return names.length === 3 && names.every((name) => SAFE_NAME.test(name));
}

export function parseAppStorage(value: unknown): AppStorage | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('volume' in value) ||
    !('path' in value) ||
    !('maxUploadFileSizeBytes' in value)
  )
    return undefined;
  if (typeof value.volume !== 'string' || typeof value.path !== 'string' || !isVolumeName(value.volume))
    return undefined;
  const prefix = `/Volumes/${value.volume.replaceAll('.', '/')}/designer_apps/`;
  if (!value.path.startsWith(prefix) || !SAFE_NAME.test(value.path.slice(prefix.length))) return undefined;
  if (
    typeof value.maxUploadFileSizeBytes !== 'number' ||
    !Number.isSafeInteger(value.maxUploadFileSizeBytes) ||
    value.maxUploadFileSizeBytes <= 0 ||
    value.maxUploadFileSizeBytes > MAX_UPLOAD_BYTES
  )
    return undefined;
  return {
    volume: value.volume,
    path: value.path,
    maxUploadFileSizeBytes: value.maxUploadFileSizeBytes,
  };
}
