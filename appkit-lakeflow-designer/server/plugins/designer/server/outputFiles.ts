import type { IAppRequest as Request } from '@databricks/appkit/dist/shared/src/plugin';
import type { RouteConfig } from '@databricks/appkit/dist/shared/src/plugin';

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
import { RUNNER_REVISION_PARAM } from '../shared/publishedRunner';
import { idString, isRecord } from '../shared/values';
import { streamFileDownload } from './fileDownloads';
import { canAccessRun } from './fileUploads';
import { runJobParameters } from './jobParameters';
import type { OutputFileStore } from './outputFileStore';
import { isLegacyExportRun, manifestRevision, type FileOutputManifest } from './runRevision';

export function recordedFileOutput(
  payload: string | undefined,
  node: string,
  config: FileOutputConfig
): WrittenFiles | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload ?? '');
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.files)) return undefined;
  const matches = parsed.files.filter(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.node === node
  );
  if (matches.length !== 1) return undefined;
  const [receipt] = matches;
  if (!Array.isArray(receipt.files) || receipt.files.length > MAX_OUTPUT_FILES) {
    return undefined;
  }
  const paths = receipt.files.map((file) => (isRecord(file) ? file.path : undefined));
  if (!paths.every((path): path is string => isOutputFilePath(path, config)) || new Set(paths).size !== paths.length) {
    return undefined;
  }
  const behavior = parseFileOutputBehavior(receipt.behavior);
  return {
    node,
    files: paths.map((path) => ({ path })),
    ...(behavior ? { behavior } : {}),
  };
}

interface Dependencies {
  jobId: string | undefined;
  manifest(): Promise<FileOutputManifest | undefined>;
  viewer(req: Request): string | undefined;
  notebookPath(): Promise<string | undefined>;
  getRun(id: number): Promise<unknown>;
  readPayload(taskId: string): Promise<string | undefined>;
  store(volume: string): OutputFileStore;
  report: (error: unknown) => void;
}

class DownloadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function registerOutputFileRoutes(route: (config: RouteConfig) => void, deps: Dependencies) {
  route({
    name: 'downloadOutput',
    method: 'get',
    path: '/run/:jobRunId/files/:outputId/:fileIndex/download',
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET') throw new DownloadError(405, 'Use GET to download the file.');
        if (req.get('range'))
          throw new DownloadError(416, 'Partial downloads are not supported. Retry the full download.');
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
          !isRecord(run) ||
          String(run.job_id) !== deps.jobId ||
          !canAccessRun(run, viewer) ||
          isLegacyExportRun(run)
        ) {
          throw new DownloadError(404, 'Run not found.');
        }
        const params = runJobParameters(run);
        if (params[APP_REVISION_PARAM] !== manifestRevision(manifest)) {
          throw new DownloadError(
            409,
            'This run uses a different file-output configuration. Run the app again to download files.'
          );
        }
        let declared: unknown;
        try {
          declared = JSON.parse(String(params[FILE_OUTPUTS_PARAM]));
        } catch {
          throw new DownloadError(409, 'This run did not declare file outputs. Run the app again.');
        }
        const declaredOutput = parseFileOutput(isRecord(declared) ? declared[block.nodeId] : undefined);
        if (!declaredOutput || JSON.stringify(declaredOutput) !== JSON.stringify(parseFileOutput(block.fileOutput))) {
          throw new DownloadError(409, 'This run did not declare this file output. Run the app again.');
        }
        const task: unknown = Array.isArray(run.tasks) && run.tasks.length === 1 ? run.tasks[0] : undefined;
        const taskId = isRecord(task) ? idString(task.run_id) : undefined;
        const currentNotebookPath = await deps.notebookPath();
        const revision = params[RUNNER_REVISION_PARAM];
        const folder = currentNotebookPath?.slice(0, currentNotebookPath.lastIndexOf('/'));
        if (
          !isRecord(task) ||
          !isRecord(task.notebook_task) ||
          !taskId ||
          !folder ||
          typeof revision !== 'string' ||
          !/^[0-9a-f]{64}$/.test(revision) ||
          task.notebook_task.notebook_path !== `${folder}/runner-${revision}.designer.py`
        ) {
          throw new DownloadError(
            409,
            'This run’s published workflow could not be verified. Run the app again to download files.'
          );
        }
        const state = isRecord(run.state) ? run.state : {};
        if (
          !state.result_state &&
          !['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR'].includes(String(state.life_cycle_state))
        ) {
          throw new DownloadError(409, 'Wait for the run to finish before downloading files.');
        }
        const receipt = recordedFileOutput(await deps.readPayload(taskId), block.nodeId, block.fileOutput);
        const indexText = String(req.params.fileIndex);
        const index = /^(0|[1-9][0-9]*)$/.test(indexText) ? Number(indexText) : -1;
        const file = receipt?.files[index];
        if (!file) throw new DownloadError(404, 'The run has no completed file at this output.');
        const store = deps.store(file.path.split('/').slice(2, 5).join('.'));
        const size = await store.size(file.path);
        if (size === undefined) {
          throw new DownloadError(404, 'This output file no longer exists at its recorded destination.');
        }
        const stream = await store.download(file.path);
        const filename = file.path.slice(file.path.lastIndexOf('/') + 1);
        await streamFileDownload(res, stream, filename, size, deps.report);
      } catch (error) {
        if (!(error instanceof DownloadError)) deps.report(error);
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : undefined);
        } else {
          res.status(error instanceof DownloadError ? error.status : 502).json({
            error:
              error instanceof DownloadError
                ? error.message
                : 'Could not read the output file. Check the App’s volume permissions and try again.',
          });
        }
      }
    },
  });
}
