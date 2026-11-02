import { Readable } from 'node:stream';

import type { IAppRequest as Request, IAppResponse as Response } from '@databricks/appkit/dist/shared/src/plugin';
import type { RouteConfig } from '@databricks/appkit/dist/shared/src/plugin';

import { validateFileFormat } from '../shared/fileFormats';
import { MAX_UPLOAD_SIZE_LABEL, UPLOAD_REFERENCE, UPLOAD_UNAVAILABLE, type AppStorage } from '../shared/storageConfig';
import { streamFileDownload } from './fileDownloads';
import { UploadError, resolveUpload, saveUploadStream, type UploadStore } from './fileUploads';

interface UploadManifest {
  storage?: AppStorage;
  parameters: { name: string; type: string; fileFormats?: string[] }[];
}

interface UploadDependencies {
  manifest(): Promise<UploadManifest | undefined>;
  viewer(req: Request): string | undefined;
  store(storage: AppStorage): UploadStore;
  report: (error: unknown) => void;
}

const fileParameter = (manifest: UploadManifest | undefined, name: string) =>
  manifest?.parameters.find((parameter) => parameter.name === name && parameter.type === 'file');

function sendUploadError(res: Response, error: unknown, fallback: string) {
  res
    .status(error instanceof UploadError ? error.status : 502)
    .json(
      error instanceof UploadError
        ? { ...(error.code ? { code: error.code } : {}), error: error.message }
        : { error: fallback }
    );
}

export function registerUploadRoutes(route: (config: RouteConfig) => void, deps: UploadDependencies) {
  let activeUploads = 0;

  route({
    name: 'downloadUpload',
    method: 'get',
    path: '/uploads/:parameterName/:reference/download',
    handler: async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (req.method !== 'GET') throw new UploadError(405, 'Use GET to download the file.');
        if (req.get('range'))
          throw new UploadError(416, 'Partial downloads are not supported. Retry the full download.');
        const viewer = deps.viewer(req);
        if (!viewer) throw new UploadError(401, 'Sign in through Databricks Apps to download files.');
        const manifest = await deps.manifest();
        const parameter = fileParameter(manifest, req.params.parameterName);
        if (!parameter || !manifest?.storage) {
          throw new UploadError(404, 'This file parameter is no longer available. Review the app inputs.', {
            code: UPLOAD_UNAVAILABLE,
          });
        }
        const reference = String(req.params.reference);
        if (!UPLOAD_REFERENCE.test(reference)) throw new UploadError(400, 'The upload reference is invalid.');
        const store = deps.store(manifest.storage);
        const { path, upload } = await resolveUpload(store, manifest.storage, viewer, parameter.name, reference);
        await streamFileDownload(res, await store.download(path), upload.filename, upload.size, deps.report);
      } catch (error) {
        if (!(error instanceof UploadError)) deps.report(error);
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : undefined);
        } else {
          sendUploadError(
            res,
            error,
            'Could not download the uploaded file. Check the app volume resource and permissions.'
          );
        }
      }
    },
  });

  route({
    name: 'upload',
    method: 'post',
    path: '/uploads/:parameterName',
    skipBodyParsing: true,
    handler: async (req, res) => {
      let admitted = false;
      try {
        const manifest = await deps.manifest();
        const parameter = fileParameter(manifest, req.params.parameterName);
        if (!parameter || !manifest?.storage) {
          res.status(404).json({
            error: 'This file parameter is no longer available. Review the app inputs.',
            code: UPLOAD_UNAVAILABLE,
          });
          return;
        }
        const viewer = deps.viewer(req);
        if (!viewer) {
          res.status(401).json({
            error: 'Sign in through Databricks Apps to upload files.',
          });
          return;
        }
        const store = deps.store(manifest.storage);
        if (req.get('content-type') !== 'application/octet-stream')
          throw new UploadError(415, 'Upload the file as an octet stream.');
        if (activeUploads >= 4) throw new UploadError(429, 'Uploads are busy. Try again shortly.');
        const contentLength = req.get('content-length');
        if (contentLength !== undefined && !/^\d+$/.test(contentLength))
          throw new UploadError(400, 'The Content-Length header is invalid.');
        const declaredSize = contentLength === undefined ? undefined : Number(contentLength);
        if (declaredSize !== undefined && declaredSize > manifest.storage.maxUploadFileSizeBytes)
          throw new UploadError(413, `The file exceeds the ${MAX_UPLOAD_SIZE_LABEL} upload limit.`);
        let filename: string;
        try {
          filename = decodeURIComponent(req.get('x-file-name') ?? '');
        } catch {
          throw new UploadError(400, 'The filename is invalid.');
        }
        const formatError = validateFileFormat(filename, parameter.fileFormats);
        if (formatError) throw new UploadError(400, formatError);
        activeUploads += 1;
        admitted = true;
        res.status(201).json({
          upload: await saveUploadStream(
            store,
            manifest.storage,
            viewer,
            parameter.name,
            filename,
            Readable.toWeb(req) as ReadableStream<Uint8Array>,
            declaredSize
          ),
        });
      } catch (error) {
        req.resume();
        sendUploadError(res, error, 'Could not store the upload. Check the app volume resource and permissions.');
      } finally {
        if (admitted) activeUploads -= 1;
      }
    },
  });
}
