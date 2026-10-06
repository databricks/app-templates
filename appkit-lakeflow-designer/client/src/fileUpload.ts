import { MAX_UPLOAD_BYTES, MAX_UPLOAD_SIZE_LABEL, UPLOAD_REFERENCE, UPLOAD_UNAVAILABLE } from '../../shared/storageConfig';
import { uploadsRoute } from './routes';
import { validateFileFormat } from '../../shared/fileFormats';

interface UploadChoice {
  reference: string;
  filename: string;
}

export class UploadUnavailableError extends Error {}

function isUpload(value: unknown): value is UploadChoice {
  return (
    typeof value === 'object' &&
    value !== null &&
    'reference' in value &&
    'filename' in value &&
    typeof value.reference === 'string' &&
    UPLOAD_REFERENCE.test(value.reference) &&
    typeof value.filename === 'string'
  );
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null) {
    throw new Error('The upload server returned an unreadable response.');
  }
  if (!response.ok) {
    const message = 'error' in value && typeof value.error === 'string' ? value.error : 'The upload request failed.';
    if ('code' in value && value.code === UPLOAD_UNAVAILABLE) throw new UploadUnavailableError(message);
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

export function validateUpload(file: File, fileFormats?: readonly string[]): string | undefined {
  return file.size === 0 || file.size > MAX_UPLOAD_BYTES
    ? `Choose a non-empty file up to ${MAX_UPLOAD_SIZE_LABEL}.`
    : validateFileFormat(file.name, fileFormats);
}

export async function uploadFile(
  parameterName: string,
  file: File,
  fileFormats?: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  const validationError = validateUpload(file, fileFormats);
  if (validationError !== undefined) throw new Error(validationError);

  const body = await readResponse(
    await fetch(uploadsRoute(parameterName), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
      signal,
    })
  );
  if (!isUpload(body.upload)) throw new Error('The server did not confirm the completed upload.');
  return body.upload.reference;
}

// A form owns one cache. Disposing it also invalidates uploads whose responses arrive late.
export function createFileUploadCache() {
  const controller = new AbortController();
  const completed = new Map<string, { file: File; reference: string }>();
  return {
    signal: controller.signal,
    dispose() {
      controller.abort();
      completed.clear();
    },
    async upload(name: string, file: File, fileFormats?: readonly string[]): Promise<string> {
      controller.signal.throwIfAborted();
      const validationError = validateUpload(file, fileFormats);
      if (validationError) throw new Error(validationError);
      const previous = completed.get(name);
      if (previous?.file === file) return previous.reference;
      const reference = await uploadFile(name, file, fileFormats, controller.signal);
      controller.signal.throwIfAborted();
      completed.set(name, { file, reference });
      return reference;
    },
  };
}
