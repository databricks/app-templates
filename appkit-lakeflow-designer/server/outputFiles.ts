import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Application, Request } from 'express';
import {
  APP_REVISION_PARAM,
  FILE_OUTPUTS_PARAM,
  isOutputFilePath,
  MAX_OUTPUT_FILES,
  parseFileOutput,
  parseFileOutputBehavior,
  type FileOutputConfig,
  type WrittenFiles,
} from '../shared/fileOutputs';
import { canAccessRun } from './fileUploads';
import { isLegacyExportRun, manifestRevision, type FileOutputManifest } from './runRevision';
import { runJobParameters } from './jobParameters';
import type { OutputFileStore } from './outputFileStore';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function recordedFileOutput(
  payload: string | undefined,
  node: string,
  config: FileOutputConfig,
): WrittenFiles | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload ?? '');
  } catch {
    return undefined;
  }
  if (!record(parsed) || !Array.isArray(parsed.files)) return undefined;
  const matches = parsed.files.filter((entry) => record(entry) && entry.node === node);
  if (matches.length !== 1) return undefined;
  const receipt = matches[0];
  if (!record(receipt) || !Array.isArray(receipt.files) || receipt.files.length > MAX_OUTPUT_FILES) {
    return undefined;
  }
  const paths = receipt.files.map((file) => (record(file) ? file.path : undefined));
  if (!paths.every((path): path is string => isOutputFilePath(path, config)) || new Set(paths).size !== paths.length) {
    return undefined;
  }
  const behavior = parseFileOutputBehavior(receipt.behavior);
  return { node, files: paths.map((path) => ({ path })), ...(behavior ? { behavior } : {}) };
}

interface Dependencies {
  jobId: string | undefined;
  manifest(): Promise<FileOutputManifest | undefined>;
  viewer(req: Request): string | undefined;
  notebookPath(): Promise<string | undefined>;
  getRun(id: number): Promise<unknown>;
  readPayload(taskId: string): Promise<string | undefined>;
  store(volume: string): OutputFileStore;
  report(error: unknown): void;
}

class DownloadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function registerOutputFileRoutes(app: Pick<Application, 'get'>, deps: Dependencies) {
  app.get('/api/designer/run/:jobRunId/files/:outputId/:fileIndex/download', async (req, res) => {
    try {
      if (req.method !== 'GET') throw new DownloadError(405, 'Use GET to download the file.');
      if (req.get('range')) throw new DownloadError(416, 'Partial downloads are not supported. Retry the full download.');
      const viewer = deps.viewer(req);
      if (!viewer) throw new DownloadError(401, 'Sign in through Databricks Apps to download files.');
      const runId = String(req.params.jobRunId);
      if (!/^[1-9][0-9]*$/.test(runId) || !Number.isSafeInteger(Number(runId))) {
        throw new DownloadError(404, 'Run not found.');
      }
      const manifest = await deps.manifest();
      if (!manifest || !deps.jobId) throw new DownloadError(409, 'File outputs are not configured.');
      const block = manifest.blocks.find((entry) => entry.type === 'output' && entry.id === req.params.outputId);
      if (!block?.fileOutput || !block.nodeId) throw new DownloadError(404, 'File output not found.');
      const run = await deps.getRun(Number(runId));
      if (
        !record(run) || String(run.job_id) !== deps.jobId ||
        !canAccessRun(run, viewer, true) || isLegacyExportRun(run)
      ) {
        throw new DownloadError(404, 'Run not found.');
      }
      const params = runJobParameters(run);
      if (params[APP_REVISION_PARAM] !== manifestRevision(manifest)) {
        throw new DownloadError(
          409,
          'This run uses a different file-output configuration. Run the app again to download files.',
        );
      }
      let declared: unknown;
      try {
        declared = JSON.parse(String(params[FILE_OUTPUTS_PARAM]));
      } catch {
        throw new DownloadError(409, 'This run did not declare file outputs. Run the app again.');
      }
      const declaredOutput = parseFileOutput(record(declared) ? declared[block.nodeId] : undefined);
      if (!declaredOutput || JSON.stringify(declaredOutput) !== JSON.stringify(parseFileOutput(block.fileOutput))) {
        throw new DownloadError(409, 'This run did not declare this file output. Run the app again.');
      }
      const task = Array.isArray(run.tasks) && run.tasks.length === 1 ? run.tasks[0] : undefined;
      if (
        !record(task) || !record(task.notebook_task) || !task.run_id ||
        typeof task.notebook_task.notebook_path !== 'string' ||
        task.notebook_task.notebook_path !== await deps.notebookPath()
      ) {
        throw new DownloadError(409, 'The runner changed since this run. Run the app again to download files.');
      }
      const state = record(run.state) ? run.state : {};
      if (!state.result_state && !['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR'].includes(String(state.life_cycle_state))) {
        throw new DownloadError(409, 'Wait for the run to finish before downloading files.');
      }
      const receipt = recordedFileOutput(await deps.readPayload(String(task.run_id)), block.nodeId, block.fileOutput);
      const indexText = String(req.params.fileIndex);
      const index = /^(0|[1-9][0-9]*)$/.test(indexText) ? Number(indexText) : -1;
      const file = receipt?.files[index];
      if (!file) throw new DownloadError(404, 'The run has no completed file at this output.');
      const store = deps.store(file.path.split('/').slice(2, 5).join('.'));
      const size = await store.size(file.path);
      if (size === undefined) {
        throw new DownloadError(404, 'This output file no longer exists at its recorded destination.');
      }
      const expectedSize = size;
      const stream = await store.download(file.path);
      const filename = file.path.slice(file.path.lastIndexOf('/') + 1);
      const fallback = filename.replace(/[^A-Za-z0-9._ -]/g, '_');
      const encoded = encodeURIComponent(filename).replace(
        /['()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
      res.setHeader('Content-Length', String(size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const reader = stream.getReader();
      const cancelRead = () => {
        void reader.cancel().catch(deps.report);
      };
      res.once('close', cancelRead);
      async function* bytes() {
        let transferred = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            transferred += next.value.byteLength;
            if (transferred > expectedSize) throw new Error('Output file changed during transfer.');
            yield next.value;
          }
          if (transferred !== expectedSize) throw new Error('Output file transfer was incomplete.');
        } finally {
          res.off('close', cancelRead);
          await reader.cancel().catch(deps.report);
          reader.releaseLock();
        }
      }
      await pipeline(Readable.from(bytes()), res);
    } catch (error) {
      if (!(error instanceof DownloadError)) deps.report(error);
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
      } else {
        res.status(error instanceof DownloadError ? error.status : 502).json({
          error: error instanceof DownloadError
            ? error.message
            : 'Could not read the output file. Check the App’s volume permissions and try again.',
        });
      }
    }
  });
}
