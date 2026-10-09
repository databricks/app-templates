import { createApp, createWorkspaceClient, server } from '@databricks/appkit';
import { exportedModelToRunPayload, findNotebookModelValue } from './exportedRunOutput';
import type { Request } from 'express';
import { UPLOAD_REFERENCE } from '../shared/storageConfig';
import { appManifestSchema, type AppManifest, type AppOutputBlock } from '../shared/appManifest';
import { canAccessRun, viewerKey } from './fileUploads';
import { appKitUploadStore } from './uploadStore';
import { registerUploadRoutes } from './uploads';
import { isReservedParameter, resolveRunParameters } from './runParameters';
import { isLegacyExportRun, manifestRevision } from './runRevision';
import { registerOutputFileRoutes, recordedFileOutput } from './outputFiles';
import { appKitOutputFileStore } from './outputFileStore';
import { APP_REVISION_PARAM, type FileOutputBehavior } from '../shared/fileOutputs';
import { runJobParameters } from './jobParameters';
import { runAttribution } from './runAttribution';
import { ensureJobViewPermission } from './jobPermissions';

// Each published app's manifest is written by the publish flow beside the runner notebook, in the
// app's own publisher-owned folder (not a shared, world-writable root), and read at startup via the
// app's own workspace client. The app locates that folder by reading its bound runner job's notebook
// path (the `job` resource is guaranteed present, and the app can read it via its CAN_MANAGE
// grant), then looks for the manifest file there. It lives outside the git-backed source and outside
// client/dist, so it is never served publicly.
const MANIFEST_FILENAME = 'designerApp.json';
const NO_OUTPUT_REASON = 'The run finished but returned no output. The notebook did not call dbutils.notebook.exit().';
const NO_OUTPUTS_REASON =
  'The run finished but returned a payload with no outputs. The notebook was published with nothing to return.';
const MISSING_OUTPUT_REASON =
  'This output is published with the app, but the run did not return it. That happens when the run predates the output being added, or when the app and its runner have drifted apart.';

// SKIPPED and INTERNAL_ERROR are terminal even when no task ran.
const TERMINAL_LIFE_CYCLE_STATES = new Set(['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isReadableError = (value: unknown): value is { type: string; message: string } =>
  isRecord(value) && typeof value.type === 'string' && typeof value.message === 'string';
const isSchemaField = (value: unknown): value is { name: string; type: string } =>
  isRecord(value) && typeof value.name === 'string' && typeof value.type === 'string';

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type ClassifiedEntry =
  | { outcome: 'malformed'; index: number; id: string | undefined; reason: string }
  | { outcome: 'computeError' | 'result'; index: number; id: string | undefined; payload: Record<string, unknown> };
type RunSummary = {
  jobRunId: string;
  taskRunId?: string;
  endTime?: number;
  startTime?: number;
  setupDurationMs?: number;
  executionDurationMs?: number;
  runPageUrl?: string;
  resultState?: string;
  lifeCycleState?: string;
  parameters?: Record<string, string>;
  parameterDisplayValues?: Record<string, string>;
};

const JOB_ID = (() => {
  const raw = process.env.DATABRICKS_JOB_ID;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  return raw.trim();
})();
// Standalone Apps provision their service principal with the App UUID. Older runtimes expose
// only that OAuth client ID; newer runtimes also provide the explicit App ID.
const APP_ID = process.env.DATABRICKS_APP_ID?.trim() || process.env.DATABRICKS_CLIENT_ID?.trim();

let workspaceClient: ReturnType<typeof createWorkspaceClient> | undefined;
const wsClient = () => {
  workspaceClient ??= createWorkspaceClient();
  return workspaceClient;
};

const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_BACKOFF_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry Jobs reads only; replaying runNow or cancelRun is unsafe.
async function retryRead<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= READ_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await read();
    } catch (err) {
      lastError = err;

      if (attempt < READ_RETRY_ATTEMPTS) {
        await sleep(READ_RETRY_BACKOFF_MS);
      }
    }
  }
  throw lastError;
}

// The manifest changes only on republish (rare), so the frequently-polled run-status endpoints
// reuse a cached read (declaredOutputs, forceFresh omitted). The page-load (/config) and run-submit
// (POST /run) paths pass forceFresh, so a republish is reflected on the next load without a redeploy
// and refreshes the cache the status endpoints read.
let cachedManifest: AppManifest | undefined;
let hasCachedManifest = false;
const loadManifest = async (forceFresh = false): Promise<AppManifest | undefined> => {
  if (!forceFresh && hasCachedManifest) {
    return cachedManifest;
  }
  const manifest = await readManifest();
  if (manifest !== undefined) {
    cachedManifest = manifest;
    hasCachedManifest = true;
  }
  // A stale pre-upload manifest must not re-enable public execution after a private republish.
  if (forceFresh && manifest === undefined) {
    cachedManifest = undefined;
    hasCachedManifest = false;
  }
  return manifest;
};

function manifestFolderFromNotebookPath(notebookPath: string): string {
  const lastSlash = notebookPath.lastIndexOf('/');
  return lastSlash <= 0 ? notebookPath : notebookPath.slice(0, lastSlash);
}

// The manifest folder is the directory holding the runner notebook. The runner job's notebook path is
// stable for the app's lifetime, so resolve it once from the bound job and cache it, rather than
// reading the job on every manifest read.
let cachedManifestFolder: string | undefined;
let hasResolvedManifestFolder = false;

async function resolveManifestFolder(): Promise<string | undefined> {
  if (hasResolvedManifestFolder) {
    return cachedManifestFolder;
  }
  if (JOB_ID === undefined) {
    return undefined;
  }
  try {
    const job = await wsClient().jobs.get({ job_id: Number(JOB_ID) });
    const notebookPath = job.settings?.tasks
      ?.map((task) => task.notebook_task?.notebook_path)
      .find((path): path is string => typeof path === 'string' && path !== '');
    if (notebookPath === undefined) {
      console.error('Could not find the runner notebook path on job', JOB_ID, 'to locate the app manifest');
      return undefined;
    }
    cachedManifestFolder = manifestFolderFromNotebookPath(notebookPath);
    hasResolvedManifestFolder = true;
    return cachedManifestFolder;
  } catch (err) {
    console.error('Could not read the runner job to locate the app manifest', err);
    return undefined;
  }
}

async function readManifest() {
  const folder = await resolveManifestFolder();
  if (folder === undefined) {
    return undefined;
  }
  const manifestPath = `${folder}/${MANIFEST_FILENAME}`;
  try {
    // The AppKit facade exposes no workspace service, so reach it through the legacy client; export
    // returns base64 content.
    const exported = await wsClient()
      .toLegacyWorkspaceClient()
      .workspace.export({ path: manifestPath, format: 'SOURCE' });
    if (typeof exported.content !== 'string') {
      return undefined;
    }
    return parseManifest(Buffer.from(exported.content, 'base64').toString('utf8'));
  } catch (err) {
    console.error('Could not read the app manifest from', manifestPath, err);
    return undefined;
  }
}

function parseManifest(raw: string): AppManifest | undefined {
  try {
    return appManifestSchema.safeParse(JSON.parse(raw)).data;
  } catch {
    return undefined;
  }
}

const requestViewer = (req: Request) => viewerKey(req.get('x-forwarded-user'), JOB_ID);

async function accessibleRun(
  run: unknown,
  req: Request,
  hydrate = false,
): Promise<Record<string, unknown> | undefined> {
  if (!runBelongsToJob(run, JOB_ID)) return undefined;
  const manifest = await loadManifest();
  if (!manifest) return undefined;
  let detail = run;
  if (
    hydrate &&
    isRecord(run) &&
    !Array.isArray(run.job_parameters)
  ) {
    const id = idFrom(run.run_id);
    if (!id) return undefined;
    detail = await wsClient().jobs.getRun({ run_id: Number(id) });
  }
  return isRecord(detail) &&
    !isLegacyExportRun(detail) &&
    runBelongsToJob(detail, JOB_ID) &&
    canAccessRun(
      detail,
      requestViewer(req),
      manifest.storage !== undefined || manifest.blocks.some((block) => block.type === 'output' && block.fileOutput),
    )
    ? detail
    : undefined;
}

function classifyOutputEntry(entry: unknown, index: number): ClassifiedEntry {
  if (!isRecord(entry)) {
    return { outcome: 'malformed', index, id: undefined, reason: 'This output is not an object.' };
  }
  const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : undefined;
  if (entry.status === 'error') {
    if (!isReadableError(entry.error)) {
      return {
        outcome: 'malformed',
        index,
        id,
        reason: 'This output reported an error, but the error was not readable.',
      };
    }
    return { outcome: 'computeError', index, id, payload: entry };
  }
  if (entry.status !== 'ok') {
    return {
      outcome: 'malformed',
      index,
      id,
      reason: `This output has an unrecognised status: ${JSON.stringify(entry.status)}`,
    };
  }
  if (!Array.isArray(entry.schema) || !Array.isArray(entry.rows)) {
    return {
      outcome: 'malformed',
      index,
      id,
      reason: 'This output reported success but is missing the schema or rows.',
    };
  }
  if (!entry.schema.every(isSchemaField) || !entry.rows.every(isRecord)) {
    return {
      outcome: 'malformed',
      index,
      id,
      reason: 'This output reported success but its schema or rows are malformed.',
    };
  }
  const fieldNames = entry.schema.map((field) => field.name);
  // Rows are keyed by column name downstream, so blank or duplicate names silently collapse
  // columns; reject the output rather than render data that has lost or merged a column.
  if (fieldNames.some((name) => name === '') || new Set(fieldNames).size !== fieldNames.length) {
    return {
      outcome: 'malformed',
      index,
      id,
      reason: 'This output reported success but its columns have blank or duplicate names.',
    };
  }
  return { outcome: 'result', index, id, payload: entry };
}

function classifyMultiRunOutput(
  raw: string | undefined,
): { outcome: 'noPayload'; reason: string } | { outcome: 'outputs'; outputs: ClassifiedEntry[] } {
  if (raw === undefined || raw.trim() === '') {
    return { outcome: 'noPayload', reason: NO_OUTPUT_REASON };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { outcome: 'noPayload', reason: `The run returned output that is not valid JSON: ${errText(err)}` };
  }
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
    return { outcome: 'noPayload', reason: 'The run returned an empty output object.' };
  }
  if (!Array.isArray(parsed.outputs)) {
    return {
      outcome: 'noPayload',
      reason: 'The run returned output with no outputs list, so it is not a multi-output payload.',
    };
  }
  if (parsed.outputs.length === 0) {
    return { outcome: 'noPayload', reason: NO_OUTPUTS_REASON };
  }
  // Classify entries independently so one malformed output does not discard valid siblings.
  return { outcome: 'outputs', outputs: parsed.outputs.map((entry, index) => classifyOutputEntry(entry, index)) };
}

const outputStringField = (payload: Record<string, unknown>, field: string): string | undefined =>
  typeof payload[field] === 'string' && payload[field] !== '' ? (payload[field] as string) : undefined;

const joinSource = (node: string | undefined, port: string | undefined): string | undefined =>
  node === undefined ? undefined : port === undefined ? node : `${node}.${port}`;

type MatchOutcome =
  | { outcome: 'malformed'; reason: string }
  | { outcome: 'computeError' | 'result'; payload: Record<string, unknown> }
  | { outcome: 'missing'; reason: string };
type OutputSection = {
  key: string;
  id?: string;
  title: string;
  source?: string;
  chartSpec?: Record<string, unknown>;
  files?: { path: string }[];
  fileBehavior?: FileOutputBehavior;
  outcome: MatchOutcome;
};

function matchedOutcome(entry: ClassifiedEntry): MatchOutcome {
  return entry.outcome === 'malformed'
    ? { outcome: 'malformed', reason: entry.reason }
    : { outcome: entry.outcome, payload: entry.payload };
}

function matchRunOutputs(declared: AppOutputBlock[], raw: string | undefined) {
  const multi = classifyMultiRunOutput(raw);
  if (multi.outcome !== 'outputs' && !declared.some((block) => block.fileOutput)) {
    return { outcome: 'noPayload', reason: multi.reason };
  }
  const classified = multi.outcome === 'outputs' ? multi.outputs : [];
  const consumed = new Set<number>();

  // The run may include other nodes and ports, but only published output blocks are exposed.
  const outputs: OutputSection[] = declared.map((output) => {
    // Each payload entry is keyed by the (node, port) from the cell's display(ctx[...]) line rather
    // than an output id, so bind the manifest output by that.
    const declaredNode = output.nodeId === '' ? undefined : output.nodeId;
    const declaredPort = output.port === '' ? undefined : output.port;
    // Well-formed entries bind by (node, port); outputStringField normalizes '' to undefined, so
    // coerce declared empties the same way (else an empty port compares undefined === '' and never
    // binds). A malformed entry carries no (node, port), so bind it to its declared block by id: the
    // block then surfaces the malformed outcome instead of reporting missing.
    const matches = (entry: ClassifiedEntry) =>
      entry.outcome === 'malformed'
        ? entry.id !== undefined && entry.id === output.id
        : outputStringField(entry.payload, 'target_node') === declaredNode &&
          outputStringField(entry.payload, 'target_port') === declaredPort;
    // Prefer an unconsumed entry so distinct blocks each take their own; fall back to any match so
    // two blocks published at the same (node, port) both render it rather than the second being
    // reported missing.
    const found = classified.find((entry) => !consumed.has(entry.index) && matches(entry)) ?? classified.find(matches);
    const source = joinSource(declaredNode, declaredPort);
    const fileReceipt = output.fileOutput ? recordedFileOutput(raw, output.nodeId, output.fileOutput) : undefined;
    const section = {
      key: `declared:${output.id}`,
      id: output.id,
      title: output.label !== '' ? output.label : output.nodeId !== '' ? output.nodeId : output.id,
      ...(source === undefined ? {} : { source }),

      ...(output.chartSpec === undefined ? {} : { chartSpec: output.chartSpec }),
      ...(output.fileOutput ? { files: fileReceipt?.files ?? [] } : {}),
      ...(fileReceipt?.behavior ? { fileBehavior: fileReceipt.behavior } : {}),
    };
    if (found === undefined) {
      return {
        ...section,
        outcome: {
          outcome: 'missing',
          reason: MISSING_OUTPUT_REASON,
        },
      };
    }
    consumed.add(found.index);
    return { ...section, outcome: matchedOutcome(found) };
  });

  return { outcome: 'outputs', outputs };
}

async function declaredOutputs() {
  return (await loadManifest())?.blocks.filter((block): block is AppOutputBlock => block.type === 'output') ?? [];
}

// runs/export returns the run's rendered notebook views; the CODE view carries the displayed
// command results. exportRun mirrors the SDK jobs surface the other jobs.* reads use.
async function readRunOutputPayload(taskRunId: string): Promise<string | undefined> {
  const exported = await retryRead(() =>
    wsClient().jobs.exportRun({ run_id: Number(taskRunId), views_to_export: 'CODE' }),
  );
  const views = isRecord(exported) && Array.isArray(exported.views) ? exported.views : [];
  // Select by the decoder's own probe, not a raw substring: the CODE view's content can be
  // base64-wrapped, and base64 never contains the literal marker, so a substring test would skip
  // an encoded view and drop a real result.
  const view = views.find(
    (candidate) => isRecord(candidate) && findNotebookModelValue(candidate.content) !== undefined,
  );
  return isRecord(view) ? exportedModelToRunPayload(view.content) : undefined;
}

const positiveIntFrom = (value: unknown) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

// Run and job IDs are int64: keep them as positive decimal strings so a value past 2^53-1 is
// not corrupted by Number. The appkit Jobs API still takes run_id as a number, so ids are cast
// at that call boundary only; everything the client sees stays full precision.
const idFrom = (value: unknown) => {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return undefined;
  }
  const text = String(value);
  return /^[1-9][0-9]*$/.test(text) ? text : undefined;
};

// Page completed runs until the newest success is in hand: a streak of recent failures must not
// hide an older successful run. Bound the scan so an all-failed history can't page forever.
const LAST_RUN_PAGE_SIZE = 25;
const LAST_RUN_SCAN_CAP = 200;
const ACTIVE_RUN_SCAN_LIMIT = 5;
const SUCCESSFUL_RESULT_STATES = new Set(['SUCCESS', 'SUCCESS_WITH_FAILURES']);

function isSuccessfulRun(run: unknown): run is Record<string, unknown> {
  return (
    isRecord(run) &&
    idFrom(run.run_id) !== undefined &&
    isRecord(run.state) &&
    typeof run.state.result_state === 'string' &&
    SUCCESSFUL_RESULT_STATES.has(run.state.result_state)
  );
}

function selectLastSuccessfulRun(runs: unknown) {
  if (!Array.isArray(runs)) {
    return undefined;
  }
  const successes = runs.filter(isSuccessfulRun);
  successes.sort((a, b) => (positiveIntFrom(b.start_time) ?? 0) - (positiveIntFrom(a.start_time) ?? 0));
  return successes[0];
}

function selectActiveRun(runs: unknown) {
  if (!Array.isArray(runs)) {
    return undefined;
  }
  const active = runs.filter((run) => isRecord(run) && idFrom(run.run_id) !== undefined);
  active.sort((a, b) => (positiveIntFrom(b.start_time) ?? 0) - (positiveIntFrom(a.start_time) ?? 0));
  return active[0];
}

function lifeCycleStateOf(run: Record<string, unknown>) {
  const state = run.state;
  return isRecord(state) && typeof state.life_cycle_state === 'string' && state.life_cycle_state !== ''
    ? state.life_cycle_state
    : undefined;
}

function summarizeLastRun(run: Record<string, unknown>): RunSummary | undefined {
  const jobRunId = idFrom(run.run_id);
  if (jobRunId === undefined) {
    return undefined;
  }
  const firstTask = (Array.isArray(run.tasks) ? run.tasks : []).find(isRecord);
  const summary: RunSummary = { jobRunId };
  const taskRunId = firstTask === undefined ? undefined : idFrom(firstTask.run_id);
  if (taskRunId !== undefined) summary.taskRunId = taskRunId;
  const endTime = positiveIntFrom(run.end_time);
  if (endTime !== undefined) summary.endTime = endTime;
  const startTime = positiveIntFrom(run.start_time);
  if (startTime !== undefined) summary.startTime = startTime;
  const setupDurationMs = positiveIntFrom(run.setup_duration);
  if (setupDurationMs !== undefined) summary.setupDurationMs = setupDurationMs;
  const executionDurationMs = positiveIntFrom(run.execution_duration);
  if (executionDurationMs !== undefined) summary.executionDurationMs = executionDurationMs;
  if (typeof run.run_page_url === 'string' && run.run_page_url !== '') summary.runPageUrl = run.run_page_url;
  return summary;
}

function runParameterData(
  run: Record<string, unknown>,
): Pick<RunSummary, 'parameters' | 'parameterDisplayValues'> | undefined {
  if (!Array.isArray(run.job_parameters)) {
    return undefined;
  }
  const params: Record<string, string> = {};
  const displayValues: Record<string, string> = {};
  for (const [name, value] of Object.entries(runJobParameters(run))) {
    if (
      isReservedParameter(name) ||
      typeof value !== 'string'
    ) {
      continue;
    }
    const isFile = cachedManifest?.parameters.some((parameter) => parameter.name === name && parameter.type === 'file');
    if (isFile) {
      const parts = value.split('/');
      const reference = `upload:${parts.at(-2)}`;
      if (UPLOAD_REFERENCE.test(reference)) {
        params[name] = reference;
        const filename = parts.at(-1);
        if (filename) displayValues[name] = filename;
      } else {
        params[name] = '';
      }
    } else {
      params[name] = value;
    }
  }
  return {
    parameters: params,
    ...(Object.keys(displayValues).length === 0 ? {} : { parameterDisplayValues: displayValues }),
  };
}

// Guard every client- or list-supplied run ID before reading output or cancelling it.
function runBelongsToJob(run: unknown, jobId: string | undefined) {
  if (jobId === undefined || !isRecord(run)) {
    return false;
  }
  return String(run.job_id) === jobId;
}

const RUN_HISTORY_DEFAULT_WINDOW = 100;
const RUN_HISTORY_MAX_WINDOW = 200;
const RUN_HISTORY_PAGE_SIZE = 25;

function resultStateOf(run: Record<string, unknown>) {
  const state = run.state;
  return isRecord(state) && typeof state.result_state === 'string' && state.result_state !== ''
    ? state.result_state
    : undefined;
}

function summarizeHistoryRun(run: Record<string, unknown>) {
  const summary = summarizeLastRun(run);
  if (summary === undefined) {
    return undefined;
  }
  delete summary.taskRunId;
  const resultState = resultStateOf(run);
  if (resultState !== undefined) summary.resultState = resultState;
  const lifeCycleState = lifeCycleStateOf(run);
  if (lifeCycleState !== undefined) summary.lifeCycleState = lifeCycleState;
  const parameterData = runParameterData(run);
  if (parameterData !== undefined) Object.assign(summary, parameterData);
  return summary;
}

const historyStartedAt = (run: Record<string, unknown>) => positiveIntFrom(run.start_time) ?? 0;

function summarizeRunHistory(runs: unknown, windowSize: number) {
  if (!Array.isArray(runs)) {
    return { entries: [], hasMore: false };
  }
  const records = runs.filter(isRecord);
  const hasMore = records.length > windowSize;
  records.sort((a, b) => historyStartedAt(b) - historyStartedAt(a));
  const entries: RunSummary[] = [];
  for (const record of records) {
    if (entries.length >= windowSize) {
      break;
    }
    const entry = summarizeHistoryRun(record);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return { entries, hasMore };
}

function resolveHistoryWindow(raw: unknown) {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return RUN_HISTORY_DEFAULT_WINDOW;
  }
  return Math.min(parsed, RUN_HISTORY_MAX_WINDOW);
}

await createApp({
  plugins: [server()],
  onPluginsReady: async (appkit) => {
    appkit.server.extend((app) => {
      // These responses contain per-viewer filenames and results, never shared cache entries.
      app.use('/api/designer', (_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
      });

      registerOutputFileRoutes(app, {
        jobId: JOB_ID,
        manifest: () => loadManifest(true),
        viewer: requestViewer,
        notebookPath: async () => {
          const job = await wsClient().jobs.get({ job_id: Number(JOB_ID) });
          const tasks = job.settings?.tasks;
          return tasks?.length === 1 ? tasks[0].notebook_task?.notebook_path : undefined;
        },
        getRun: (run_id) => wsClient().jobs.getRun({ run_id }),
        readPayload: readRunOutputPayload,
        store: appKitOutputFileStore,
        report: (error) => console.error('Output file download failed', error),
      });

      registerUploadRoutes(app, {
        manifest: () => loadManifest(true),
        viewer: requestViewer,
        store: appKitUploadStore,
        report: (error) => console.error('Uploaded file download failed', error),
      });

      app.get('/api/designer/config', async (_req, res) => {
        try {
          const manifest = await loadManifest(true);
          if (manifest === undefined) {
            res.json({ manifest: null, runnable: false, notRunnableReason: 'noManifest' });
            return;
          }
          if (JOB_ID === undefined) {
            res.json({ manifest, runnable: false, notRunnableReason: 'noJob' });
            return;
          }
          res.json({ manifest, runnable: true });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: 'The app could not read its own configuration.' });
        }
      });

      app.get('/api/designer/last-run', async (req, res) => {
        if (JOB_ID === undefined) {
          res.json({ status: 'noJob' });
          return;
        }

        let listed = [];
        try {
          listed = await retryRead(async () => {
            const collected = [];
            let scanned = 0;

            // completed_only includes failures. Keep paging until the newest success is in hand so
            // a run of recent failures doesn't hide an older success, bounded by LAST_RUN_SCAN_CAP.
            for await (const run of wsClient().jobs.listRuns({
              job_id: Number(JOB_ID),
              completed_only: true,
              expand_tasks: true,
              limit: LAST_RUN_PAGE_SIZE,
            })) {
              const visible = await accessibleRun(run, req, true);
              if (visible) {
                collected.push(visible);
                if (isSuccessfulRun(visible)) break;
              }

              if (++scanned >= LAST_RUN_SCAN_CAP) {
                break;
              }
            }
            return collected;
          });
        } catch (err) {
          console.error(err);
          res.json({ status: 'unavailable', reason: `Could not read this app's run history: ${errText(err)}` });
          return;
        }

        let active;
        try {
          // Trust active_only instead of duplicating Jobs lifecycle-state logic.
          const activeRuns = [];
          let scannedActive = 0;
          // DELIBERATELY NOT WRAPPED in retryRead; this best-effort signal must not delay primary content.
          for await (const candidate of wsClient().jobs.listRuns({
            job_id: Number(JOB_ID),
            active_only: true,
            expand_tasks: true,
            limit: ACTIVE_RUN_SCAN_LIMIT,
          })) {
            const visible = await accessibleRun(candidate, req, true);
            if (visible) {
              activeRuns.push(visible);
            }
            if (++scannedActive >= LAST_RUN_SCAN_CAP || activeRuns.length >= ACTIVE_RUN_SCAN_LIMIT) {
              break;
            }
          }
          const activeRun = selectActiveRun(activeRuns);
          const activeSummary = activeRun === undefined ? undefined : summarizeLastRun(activeRun);
          if (activeRun !== undefined && activeSummary !== undefined) {
            const activeParameterData = runParameterData(activeRun);
            active = {
              run: activeSummary,
              ...activeParameterData,

              ...(lifeCycleStateOf(activeRun) === undefined ? {} : { lifeCycleState: lifeCycleStateOf(activeRun) }),
            };
          }
        } catch (err) {
          console.error(err);
        }

        const run = selectLastSuccessfulRun(listed);
        const summary = run === undefined ? undefined : summarizeLastRun(run);
        if (run === undefined || summary === undefined) {
          res.json({ status: 'none', ...(active === undefined ? {} : { active }) });
          return;
        }
        summary.resultState = resultStateOf(run);

        const parameterData = runParameterData(run);

        const found = {
          status: 'found',
          run: summary,
          ...parameterData,
          ...(active === undefined ? {} : { active }),
        };

        if (summary.taskRunId === undefined) {
          res.json({
            ...found,
            result: { outcome: 'noPayload', reason: 'The run reported no task, so it has no output to read.' },
          });
          return;
        }

        try {
          // Jobs requires the task run ID here, not the job run ID.
          const payload = await readRunOutputPayload(summary.taskRunId);
          res.json({ ...found, result: matchRunOutputs(await declaredOutputs(), payload) });
        } catch (err) {
          res.json({
            ...found,
            result: { outcome: 'noPayload', reason: `Could not read the run output: ${errText(err)}` },
          });
        }
      });

      app.post('/api/designer/run', async (req, res) => {
        try {
          const manifest = await loadManifest(true);
          if (manifest === undefined) {
            res.status(409).json({ error: 'This app has no published configuration, so it cannot run.' });
            return;
          }
          if (JOB_ID === undefined) {
            res.status(409).json({ error: 'This app is not connected to a job yet, so it cannot run.' });
            return;
          }
          if (!APP_ID) {
            res.status(409).json({ error: 'This app has no runtime App ID, so it cannot attribute Job runs.' });
            return;
          }
          const attribution = await runAttribution(req, APP_ID, (token) =>
            createWorkspaceClient({ host: wsClient().config.host, token }).currentUser.me(),
          );
          const userName = attribution?._lb_app_user_email;
          if (!attribution || !userName) {
            res.status(401).json({ error: 'Sign in through Databricks Apps to run this app.' });
            return;
          }
          const submitted = isRecord(req.body) && isRecord(req.body.params) ? req.body.params : {};
          const resolved = await resolveRunParameters(
            manifest,
            submitted,
            requestViewer(req),
            appKitUploadStore(manifest.storage),
          );
          if (!resolved.ok) {
            res.status(400).json({ error: resolved.error, ...(resolved.code ? { code: resolved.code } : {}) });
            return;
          }

          await ensureJobViewPermission(wsClient(), JOB_ID, userName);

          // Writes MUST NEVER BE retried; replaying runNow can start duplicate compute.
          resolved.params[APP_REVISION_PARAM] = manifestRevision(manifest);
          const run = await wsClient().jobs.runNow({
            job_id: Number(JOB_ID),
            job_parameters: { ...resolved.params, ...attribution },
          });
          const jobRunId = idFrom(run?.run_id);
          if (jobRunId === undefined) {
            res.status(502).json({ error: 'The platform accepted the request but returned no run id.' });
            return;
          }
          res.json({ jobRunId });
        } catch (err) {
          console.error(err);
          res.status(502).json({ error: `Could not start the run: ${errText(err)}` });
        }
      });

      app.get('/api/designer/run/:jobRunId', async (req, res) => {
        const jobRunId = idFrom(req.params.jobRunId);
        if (jobRunId === undefined) {
          res.status(400).json({ error: 'jobRunId must be a positive integer.' });
          return;
        }

        let run;
        try {
          run = await retryRead(() => wsClient().jobs.getRun({ run_id: Number(jobRunId) }));
        } catch (err) {
          res.status(502).json({ error: `Could not read run ${jobRunId}: ${errText(err)}` });
          return;
        }

        const visibleRun = await accessibleRun(run, req);
        if (visibleRun === undefined) {
          res.status(404).json({ error: `Run ${jobRunId} is not a run of this app.` });
          return;
        }

        const lifeCycleState = run.state?.life_cycle_state;
        const resultState = run.state?.result_state;
        // A run carrying a result_state has finished even if its lifecycle value is absent or one
        // this list does not know yet, so treat that as terminal rather than polling it forever.
        const terminal =
          (lifeCycleState != null && TERMINAL_LIFE_CYCLE_STATES.has(lifeCycleState)) || resultState != null;
        const snapshot = {
          jobRunId,
          taskRunId: idFrom(run.tasks?.[0]?.run_id),
          lifeCycleState,
          resultState,
          stateMessage: run.state?.state_message,
          setupDurationMs: run.setup_duration,
          executionDurationMs: run.execution_duration,
          runPageUrl: run.run_page_url,
          terminal,
          ...runParameterData(visibleRun),
        };

        if (!terminal) {
          res.json(snapshot);
          return;
        }

        if (
          (resultState === undefined || !SUCCESSFUL_RESULT_STATES.has(resultState)) &&
          !(await declaredOutputs()).some((block) => block.fileOutput)
        ) {
          res.json({
            ...snapshot,
            result: {
              outcome: 'noPayload',
              reason:
                run.state?.state_message?.trim() ||
                `The run ended in state ${resultState ?? 'UNKNOWN'} without producing output.`,
            },
          });
          return;
        }

        if (snapshot.taskRunId === undefined) {
          res.json({
            ...snapshot,
            result: { outcome: 'noPayload', reason: 'The run reported no task, so it has no output to read.' },
          });
          return;
        }

        try {
          // Jobs requires the task run ID here, not the job run ID.
          const payload = await readRunOutputPayload(snapshot.taskRunId);
          res.json({ ...snapshot, result: matchRunOutputs(await declaredOutputs(), payload) });
        } catch (err) {
          res.json({
            ...snapshot,
            result: { outcome: 'noPayload', reason: `Could not read the run output: ${errText(err)}` },
          });
        }
      });

      app.delete('/api/designer/run/:jobRunId', async (req, res) => {
        const jobRunId = idFrom(req.params.jobRunId);
        if (jobRunId === undefined) {
          res.status(400).json({ error: 'jobRunId must be a positive integer.' });
          return;
        }

        let run;
        try {
          run = await retryRead(() => wsClient().jobs.getRun({ run_id: Number(jobRunId) }));
        } catch (err) {
          res.status(502).json({ error: `Could not read run ${jobRunId}: ${errText(err)}` });
          return;
        }
        if (!(await accessibleRun(run, req))) {
          res.status(404).json({ error: `Run ${jobRunId} is not a run of this app.` });
          return;
        }

        try {
          // Never retry writes; polling settles cancellation from the run's own state.
          await wsClient().jobs.cancelRun({ run_id: Number(jobRunId) });
          res.json({ cancelled: true });
        } catch (err) {
          console.error(err);
          res.status(502).json({ error: `Could not cancel run ${jobRunId}: ${errText(err)}` });
        }
      });

      app.get('/api/designer/runs', async (req, res) => {
        if (JOB_ID === undefined) {
          res.json({ status: 'noJob' });
          return;
        }
        const windowSize = resolveHistoryWindow(req.query?.window);

        let history = [];
        try {
          history = await retryRead(async () => {
            const collected = [];
            let scanned = 0;
            // listRuns caps page size at 26; stop the generator once the requested window is full.
            for await (const run of wsClient().jobs.listRuns({
              job_id: Number(JOB_ID),
              completed_only: true,
              limit: RUN_HISTORY_PAGE_SIZE,
            })) {
              const visible = await accessibleRun(run, req, true);
              if (visible) {
                collected.push(visible);
              }

              if (collected.length > windowSize || ++scanned >= LAST_RUN_SCAN_CAP) {
                break;
              }
            }
            return collected;
          });
        } catch (err) {
          console.error(err);
          res.json({ status: 'unavailable', reason: `Could not read this app's run history: ${errText(err)}` });
          return;
        }

        const page = summarizeRunHistory(history, windowSize);

        res.json({ status: 'found', runs: page.entries, hasMore: page.hasMore, window: windowSize });
      });
    });
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
