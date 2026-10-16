import { createApp, createWorkspaceClient, server, type WorkspaceClient } from '@databricks/appkit';
import { exportedModelToRunPayload, findNotebookModelValue } from './exportedRunOutput';
import { matchRunOutputs } from './runOutputs';
import type { Request, Response } from 'express';
import { UPLOAD_REFERENCE } from '../shared/storageConfig';
import { appManifestSchema, isReservedParameter, type AppManifest, type AppOutputBlock } from '../shared/appManifest';
import { errorMessage, idString, isRecord, nonEmptyString, positiveInt } from '../shared/values';
import { canAccessRun, viewerKey } from './fileUploads';
import { appKitUploadStore } from './uploadStore';
import { registerUploadRoutes } from './uploads';
import { resolveRunParameters } from './runParameters';
import { isLegacyExportRun, manifestRevision } from './runRevision';
import { registerOutputFileRoutes } from './outputFiles';
import { appKitOutputFileStore } from './outputFileStore';
import { APP_REVISION_PARAM } from '../shared/fileOutputs';
import { runJobParameters } from './jobParameters';
import { runAttribution } from './runAttribution';
import { ensureJobViewPermission } from './jobPermissions';
import { isSameOriginBrowserRequest } from './browserRequestOrigin';

// Publishing writes the manifest beside the runner notebook in the app's publisher-owned folder, outside
// the git-backed source and client/dist, so it is never served publicly.
const MANIFEST_FILENAME = 'designerApp.json';
// SKIPPED and INTERNAL_ERROR are terminal even when no task ran.
const TERMINAL_LIFE_CYCLE_STATES = new Set(['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR']);

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

const JOB_ID = process.env.DATABRICKS_JOB_ID?.trim() || undefined;
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

// Polled run-status reads reuse the cached manifest; other routes pass forceFresh, so a republish
// takes effect without a redeploy.
let cachedManifest: AppManifest | undefined;
const loadManifest = async (forceFresh = false): Promise<AppManifest | undefined> => {
  if (!forceFresh && cachedManifest !== undefined) {
    return cachedManifest;
  }
  const manifest = await readManifest();
  // A stale pre-upload manifest must not re-enable public execution after a private republish.
  if (manifest !== undefined || forceFresh) {
    cachedManifest = manifest;
  }
  return manifest;
};

function manifestFolderFromNotebookPath(notebookPath: string): string {
  const lastSlash = notebookPath.lastIndexOf('/');
  return lastSlash <= 0 ? notebookPath : notebookPath.slice(0, lastSlash);
}

// The runner notebook path is stable for the app's lifetime, so resolve its folder from the bound job once.
let cachedManifestFolder: string | undefined;

async function resolveManifestFolder(): Promise<string | undefined> {
  if (cachedManifestFolder !== undefined) {
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
  if (hydrate && isRecord(run) && !Array.isArray(run.job_parameters)) {
    const id = idString(run.run_id);
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

// Guard every client-supplied run ID before reading output or cancelling it.
async function readViewerRun(req: Request, res: Response) {
  const jobRunId = idString(req.params.jobRunId);
  if (jobRunId === undefined) {
    res.status(400).json({ error: 'jobRunId must be a positive integer.' });
    return undefined;
  }
  let run;
  try {
    run = await retryRead(() => wsClient().jobs.getRun({ run_id: Number(jobRunId) }));
  } catch (err) {
    res.status(502).json({ error: `Could not read run ${jobRunId}: ${errorMessage(err)}` });
    return undefined;
  }
  const visibleRun = await accessibleRun(run, req);
  if (visibleRun === undefined) {
    res.status(404).json({ error: `Run ${jobRunId} is not a run of this app.` });
    return undefined;
  }
  return { jobRunId, run, visibleRun };
}

async function declaredOutputs() {
  return (await loadManifest())?.blocks.filter((block): block is AppOutputBlock => block.type === 'output') ?? [];
}

// The runs/export CODE view carries the displayed command results.
async function readRunExport(taskRunId: string): Promise<unknown> {
  const exported = await retryRead(() =>
    wsClient().jobs.exportRun({ run_id: Number(taskRunId), views_to_export: 'CODE' }),
  );
  const views = isRecord(exported) && Array.isArray(exported.views) ? exported.views : [];
  // Probe with the decoder rather than a substring: a base64-wrapped view never contains the literal marker.
  const view = views.find(
    (candidate) => isRecord(candidate) && findNotebookModelValue(candidate.content) !== undefined,
  );
  return isRecord(view) ? view.content : undefined;
}

interface CompletedTaskOutput {
  payload?: string;
  failureReason?: string;
  readError?: string;
}

const COMPLETED_RESULT_CACHE_LIMIT = 20;
const COMPLETED_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const completedTaskOutputs = new Map<string, { expiresAt: number; value: Promise<CompletedTaskOutput> }>();

async function readCompletedTaskOutput(taskRunId: string, failed = false): Promise<CompletedTaskOutput> {
  const key = `${taskRunId}:${failed}`;
  const now = Date.now();
  const cached = completedTaskOutputs.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  for (const [id, entry] of completedTaskOutputs) {
    if (entry.expiresAt <= now) completedTaskOutputs.delete(id);
  }
  const value = Promise.allSettled([
    readRunExport(taskRunId),
    failed ? retryRead(() => wsClient().jobs.getRunOutput({ run_id: Number(taskRunId) })) : Promise.resolve(undefined),
  ]).then(([exported, taskOutput]) => {
    const taskError = taskOutput.status === 'fulfilled' ? taskOutput.value : undefined;
    const taskErrorTexts = [taskError?.error, taskError?.error_trace].filter((text): text is string => typeof text === 'string');
    const html = exported.status === 'fulfilled' ? exported.value : undefined;
    // Retention gaps and transient read errors can recover; do not retain them for the full cache TTL.
    if (exported.status === 'rejected' || taskOutput.status === 'rejected' || html === undefined) {
      const entry = completedTaskOutputs.get(key);
      if (entry?.value === value) entry.expiresAt = Date.now() + 5000;
    }
    return {
      payload: exportedModelToRunPayload(html, taskErrorTexts),
      failureReason: nonEmptyString(taskError?.error) ?? nonEmptyString(taskError?.error_trace),
      ...(exported.status === 'rejected' ? { readError: errorMessage(exported.reason) } : {}),
    };
  });
  // Cache only after access checks, and share the in-flight read across concurrent viewers/pollers.
  completedTaskOutputs.set(key, { expiresAt: now + COMPLETED_RESULT_CACHE_TTL_MS, value });
  while (completedTaskOutputs.size > COMPLETED_RESULT_CACHE_LIMIT) {
    completedTaskOutputs.delete(completedTaskOutputs.keys().next().value!);
  }
  return value;
}

async function readRunOutputPayload(taskRunId: string): Promise<string | undefined> {
  return (await readCompletedTaskOutput(taskRunId)).payload;
}

async function readRunResult(taskRunId: string | undefined, failed = false) {
  if (taskRunId === undefined) {
    return { outcome: 'noPayload', reason: 'The run reported no task, so it has no output to read.' };
  }
  try {
    // Jobs requires the task run ID here, not the job run ID.
    const { payload, failureReason, readError } = await readCompletedTaskOutput(taskRunId, failed);
    const result = matchRunOutputs(await declaredOutputs(), payload);
    return {
      ...result,
      ...(failureReason ? { failureReason } : {}),
      ...(result.outcome === 'noPayload' && readError ? { reason: `Could not read the run output: ${readError}` } : {}),
    };
  } catch (err) {
    return { outcome: 'noPayload', reason: `Could not read the run output: ${errorMessage(err)}` };
  }
}

const LAST_RUN_PAGE_SIZE = 25;
const ACTIVE_RUN_SCAN_LIMIT = 5;
// Bounds every run-list scan so a history with few visible runs cannot page forever.
const RUN_SCAN_CAP = 200;
const SUCCESSFUL_RESULT_STATES = new Set(['SUCCESS', 'SUCCESS_WITH_FAILURES']);

type ListRunsRequest = Parameters<WorkspaceClient['jobs']['listRuns']>[0];

async function collectVisibleRuns(
  req: Request,
  options: Omit<ListRunsRequest, 'job_id'>,
  isComplete: (visible: Record<string, unknown>[]) => boolean,
): Promise<Record<string, unknown>[]> {
  const visible: Record<string, unknown>[] = [];
  let scanned = 0;
  for await (const run of wsClient().jobs.listRuns({ job_id: Number(JOB_ID), ...options })) {
    const accessible = await accessibleRun(run, req, true);
    if (accessible) {
      visible.push(accessible);
      if (isComplete(visible)) break;
    }
    if (++scanned >= RUN_SCAN_CAP) break;
  }
  return visible;
}

function isSuccessfulRun(run: unknown): run is Record<string, unknown> {
  return (
    isRecord(run) &&
    idString(run.run_id) !== undefined &&
    isRecord(run.state) &&
    typeof run.state.result_state === 'string' &&
    SUCCESSFUL_RESULT_STATES.has(run.state.result_state)
  );
}

const startedAt = (run: Record<string, unknown>) => positiveInt(run.start_time) ?? 0;
const newestFirst = (a: Record<string, unknown>, b: Record<string, unknown>) => startedAt(b) - startedAt(a);

function selectLastSuccessfulRun(runs: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return runs.filter(isSuccessfulRun).sort(newestFirst)[0];
}

function selectActiveRun(runs: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return runs.filter((run) => idString(run.run_id) !== undefined).sort(newestFirst)[0];
}

const lifeCycleStateOf = (run: Record<string, unknown>) =>
  isRecord(run.state) ? nonEmptyString(run.state.life_cycle_state) : undefined;

const resultStateOf = (run: Record<string, unknown>) =>
  isRecord(run.state) ? nonEmptyString(run.state.result_state) : undefined;

function summarizeLastRun(run: Record<string, unknown>): RunSummary | undefined {
  const jobRunId = idString(run.run_id);
  if (jobRunId === undefined) {
    return undefined;
  }
  const firstTask = (Array.isArray(run.tasks) ? run.tasks : []).find(isRecord);
  const summary: RunSummary = { jobRunId };
  const taskRunId = idString(firstTask?.run_id);
  if (taskRunId !== undefined) summary.taskRunId = taskRunId;
  const endTime = positiveInt(run.end_time);
  if (endTime !== undefined) summary.endTime = endTime;
  const startTime = positiveInt(run.start_time);
  if (startTime !== undefined) summary.startTime = startTime;
  const setupDurationMs = positiveInt(run.setup_duration);
  if (setupDurationMs !== undefined) summary.setupDurationMs = setupDurationMs;
  const executionDurationMs = positiveInt(run.execution_duration);
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
    if (isReservedParameter(name)) {
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

function runBelongsToJob(run: unknown, jobId: string | undefined) {
  if (jobId === undefined || !isRecord(run)) {
    return false;
  }
  return String(run.job_id) === jobId;
}

const RUN_HISTORY_DEFAULT_WINDOW = 100;
const RUN_HISTORY_MAX_WINDOW = 200;
// listRuns caps page size at 26.
const RUN_HISTORY_PAGE_SIZE = 25;

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

function summarizeRunHistory(runs: Record<string, unknown>[], windowSize: number) {
  return {
    entries: [...runs].sort(newestFirst).flatMap((run) => summarizeHistoryRun(run) ?? []).slice(0, windowSize),
    hasMore: runs.length > windowSize,
  };
}

function resolveHistoryWindow(raw: unknown) {
  const parsed = Number(raw);
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
      app.use('/api/designer', (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        if (!isSameOriginBrowserRequest({
          origin: req.get('origin'),
          // Apps ingress can rewrite Host; the runtime URL names the public origin.
          appUrl: process.env.DATABRICKS_APP_URL || `${req.protocol}://${req.get('host')}`,
          fetchSite: req.get('sec-fetch-site'),
        })) {
          res.status(403).json({ error: 'Open the App directly to use its APIs.' });
          return;
        }
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

        let listed: Record<string, unknown>[];
        try {
          // completed_only includes failures, so page until the newest success is in hand: a streak
          // of recent failures must not hide an older successful run.
          listed = await retryRead(() =>
            collectVisibleRuns(
              req,
              { completed_only: true, expand_tasks: true, limit: LAST_RUN_PAGE_SIZE },
              (visible) => isSuccessfulRun(visible.at(-1)),
            ),
          );
        } catch (err) {
          console.error(err);
          res.json({ status: 'unavailable', reason: `Could not read this app's run history: ${errorMessage(err)}` });
          return;
        }

        let active;
        try {
          // Trust active_only instead of duplicating Jobs lifecycle-state logic. Not retried: this
          // best-effort signal must not delay primary content.
          const activeRun = selectActiveRun(
            await collectVisibleRuns(
              req,
              { active_only: true, expand_tasks: true, limit: ACTIVE_RUN_SCAN_LIMIT },
              (visible) => visible.length >= ACTIVE_RUN_SCAN_LIMIT,
            ),
          );
          const activeSummary = activeRun === undefined ? undefined : summarizeLastRun(activeRun);
          if (activeRun !== undefined && activeSummary !== undefined) {
            const lifeCycleState = lifeCycleStateOf(activeRun);
            active = {
              run: activeSummary,
              ...runParameterData(activeRun),
              ...(lifeCycleState === undefined ? {} : { lifeCycleState }),
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
        res.json({
          status: 'found',
          run: summary,
          ...runParameterData(run),
          ...(active === undefined ? {} : { active }),
          result: await readRunResult(summary.taskRunId),
        });
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
          const jobRunId = idString(run?.run_id);
          if (jobRunId === undefined) {
            res.status(502).json({ error: 'The platform accepted the request but returned no run id.' });
            return;
          }
          res.json({ jobRunId });
        } catch (err) {
          console.error(err);
          res.status(502).json({ error: `Could not start the run: ${errorMessage(err)}` });
        }
      });

      app.get('/api/designer/run/:jobRunId', async (req, res) => {
        const found = await readViewerRun(req, res);
        if (found === undefined) return;
        const { jobRunId, run, visibleRun } = found;

        const lifeCycleState = run.state?.life_cycle_state;
        const resultState = run.state?.result_state;
        // A run carrying a result_state has finished even if its lifecycle value is absent or one
        // this list does not know yet, so treat that as terminal rather than polling it forever.
        const terminal =
          (lifeCycleState != null && TERMINAL_LIFE_CYCLE_STATES.has(lifeCycleState)) || resultState != null;
        const snapshot = {
          jobRunId,
          taskRunId: idString(run.tasks?.[0]?.run_id),
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

        const failed = resultState === undefined || !SUCCESSFUL_RESULT_STATES.has(resultState);
        res.json({ ...snapshot, result: await readRunResult(snapshot.taskRunId, failed) });
      });

      app.delete('/api/designer/run/:jobRunId', async (req, res) => {
        const found = await readViewerRun(req, res);
        if (found === undefined) return;
        try {
          // Never retry writes; polling settles cancellation from the run's own state.
          await wsClient().jobs.cancelRun({ run_id: Number(found.jobRunId) });
          res.json({ cancelled: true });
        } catch (err) {
          console.error(err);
          res.status(502).json({ error: `Could not cancel run ${found.jobRunId}: ${errorMessage(err)}` });
        }
      });

      app.get('/api/designer/runs', async (req, res) => {
        if (JOB_ID === undefined) {
          res.json({ status: 'noJob' });
          return;
        }
        const windowSize = resolveHistoryWindow(req.query?.window);

        let history: Record<string, unknown>[];
        try {
          // One visible run past the window shows that older history exists.
          history = await retryRead(() =>
            collectVisibleRuns(
              req,
              { completed_only: true, limit: RUN_HISTORY_PAGE_SIZE },
              (visible) => visible.length > windowSize,
            ),
          );
        } catch (err) {
          console.error(err);
          res.json({ status: 'unavailable', reason: `Could not read this app's run history: ${errorMessage(err)}` });
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
