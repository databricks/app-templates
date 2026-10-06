import { createHash, randomUUID } from 'node:crypto';
import {
  MAX_UPLOAD_SIZE_LABEL,
  UPLOAD_REFERENCE,
  UPLOAD_UNAVAILABLE,
  uploadStoragePath,
  type AppStorage,
} from '../shared/storageConfig';
import { runJobParameters } from './jobParameters';

export const APP_VIEWER_PARAM = '_lb_app_viewer';

export class UploadError extends Error {
  status: number;
  code?: typeof UPLOAD_UNAVAILABLE;
  constructor(status: number, message: string, options?: ErrorOptions & { code?: typeof UPLOAD_UNAVAILABLE }) {
    super(message, options);
    this.status = status;
    this.code = options?.code;
  }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Databricks Apps supplies this header at its authenticated ingress. Never take identity from a body/query.
export function viewerKey(forwardedUser: string | undefined, jobId: string | undefined): string | undefined {
  return forwardedUser?.trim() && jobId ? hash(JSON.stringify([jobId, forwardedUser.trim()])) : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function canAccessRun(run: unknown, viewer: string | undefined, privateApp: boolean): boolean {
  const owner = runJobParameters(run)[APP_VIEWER_PARAM];
  if (owner === undefined) return !privateApp;
  return viewer !== undefined && owner === viewer;
}

export interface StoredUpload {
  reference: string;
  filename: string;
  size: number;
  createdAt: number;
}

// Keep storage operations behind a small boundary so failures/partial writes can be exercised without UC.
export interface UploadStore {
  mkdir(path: string): Promise<void>;
  put(path: string, bytes: Uint8Array): Promise<void>;
  putStream(path: string, stream: ReadableStream<Uint8Array>): Promise<void>;
  read(path: string): Promise<unknown>;
  size(path: string): Promise<number | undefined>;
  delete(path: string): Promise<void>;
}

function uploadFolder(config: AppStorage, viewer: string, parameterName: string): string {
  return `${uploadStoragePath(config)}/${viewer}/${hash(parameterName)}`;
}

function uploadId(reference: string): string {
  const id = UPLOAD_REFERENCE.exec(reference)?.[1];
  if (!id) throw new UploadError(400, 'Choose an uploaded file before running.');
  return id;
}

function isValidFilename(filename: string): boolean {
  return (
    filename.trim() !== '' &&
    filename !== '.' &&
    filename !== '..' &&
    Buffer.byteLength(filename, 'utf8') <= 255 &&
    !/[/\\\x00-\x1f\x7f]/.test(filename)
  );
}

function parseStoredUpload(raw: unknown, reference: string, maxBytes: number): StoredUpload {
  if (
    !isRecord(raw) ||
    raw.reference !== reference ||
    typeof raw.filename !== 'string' ||
    !isValidFilename(raw.filename) ||
    typeof raw.size !== 'number' ||
    !Number.isSafeInteger(raw.size) ||
    raw.size <= 0 ||
    raw.size > maxBytes ||
    typeof raw.createdAt !== 'number' ||
    !Number.isFinite(raw.createdAt)
  ) {
    throw new UploadError(409, 'This upload is incomplete or unreadable. Upload the file again.', {
      code: UPLOAD_UNAVAILABLE,
    });
  }
  return { reference, filename: raw.filename, size: raw.size, createdAt: raw.createdAt };
}

export async function resolveUpload(
  store: UploadStore,
  config: AppStorage,
  viewer: string,
  parameterName: string,
  reference: string,
) {
  const id = uploadId(reference);
  const folder = uploadFolder(config, viewer, parameterName);
  const upload = parseStoredUpload(await store.read(`${folder}/${id}.json`), reference, config.maxUploadFileSizeBytes);
  const path = `${folder}/${id}/${upload.filename}`;
  if ((await store.size(path)) !== upload.size)
    throw new UploadError(409, 'The uploaded file is missing or has changed. Upload the file again.', {
      code: UPLOAD_UNAVAILABLE,
    });
  return { path, upload };
}

export async function saveUploadStream(
  store: UploadStore,
  config: AppStorage,
  viewer: string,
  parameterName: string,
  filename: string,
  stream: ReadableStream<Uint8Array>,
  declaredSize?: number,
): Promise<StoredUpload> {
  if (!isValidFilename(filename)) throw new UploadError(400, 'Choose a file with a valid filename.');
  if (declaredSize !== undefined && declaredSize > config.maxUploadFileSizeBytes)
    throw new UploadError(413, `Files must be at most ${MAX_UPLOAD_SIZE_LABEL}.`);
  const folder = uploadFolder(config, viewer, parameterName);
  const id = randomUUID();
  // Isolate each upload so its original extension survives and JSON data cannot collide with its sidecar.
  const path = `${folder}/${id}/${filename}`;
  await store.mkdir(`${folder}/${id}`);
  let size = 0;
  let validationError: UploadError | undefined;
  const boundedStream = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > config.maxUploadFileSizeBytes) {
          validationError = new UploadError(413, `Files must be at most ${MAX_UPLOAD_SIZE_LABEL}.`);
          throw validationError;
        }
        if (declaredSize !== undefined && size > declaredSize) {
          validationError = new UploadError(400, 'The upload exceeded its declared size.');
          throw validationError;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  try {
    await store.putStream(path, boundedStream);
    if (size === 0) throw new UploadError(400, 'Choose a non-empty file.');
    if (declaredSize !== undefined && size !== declaredSize)
      throw new UploadError(400, 'The upload did not match its declared size.');
    const upload: StoredUpload = { reference: `upload:${id}`, filename, size, createdAt: Date.now() };
    // The sidecar is the completion marker; partially written files can never be selected for a run.
    await store.put(`${folder}/${id}.json`, Buffer.from(JSON.stringify(upload)));
    return upload;
  } catch (error) {
    await store.delete(path).catch(() => undefined);
    throw validationError ?? error;
  }
}

export function saveUpload(
  store: UploadStore,
  config: AppStorage,
  viewer: string,
  parameterName: string,
  filename: string,
  bytes: Uint8Array,
): Promise<StoredUpload> {
  return saveUploadStream(
    store,
    config,
    viewer,
    parameterName,
    filename,
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    bytes.byteLength,
  );
}
