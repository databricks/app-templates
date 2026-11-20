import type { WorkspaceClient } from './workspaceClient';
import type { IAppRequest as Request, IAppResponse as Response } from '@databricks/appkit/dist/shared/src/plugin';
import type { RouteConfig } from '@databricks/appkit/dist/shared/src/plugin';
import { format } from 'node:util';

import { createWorkspaceClient, type IAppRouter, type ITelemetry, SeverityNumber } from '@databricks/appkit';
import { isReservedParameter, type AppOutputBlock } from '../shared/appManifest';
import type { RunSummary } from '../shared/runSummary';
import { createManifestLoader, jobNotebookPaths } from './manifest';
import { APP_REVISION_PARAM } from '../shared/fileOutputs';
import { APP_UPDATING_MESSAGE, isPublishedRunner } from '../shared/publishedRunner';
import { UPLOAD_REFERENCE } from '../shared/storageConfig';
import { errorMessage, idString, isRecord, nonEmptyString, positiveInt } from '../shared/values';
import { isSameOriginBrowserRequest } from './browserRequestOrigin';
import { exportedModelToRunPayload, findNotebookModelValue } from './exportedRunOutput';
import { canAccessRun, viewerKey } from './fileUploads';
import { runJobParameters } from './jobParameters';
import { registerOutputFileRoutes } from './outputFiles';
import { createOutputFileStore } from './outputFileStore';
import { runAttribution } from './runAttribution';
import { scanVisibleRuns, type VisibleRunPage } from './runHistory';
import { matchRunOutputs } from './runOutputs';
import { resolveRunParameters } from './runParameters';
import { isLegacyExportRun, manifestRevision } from './runRevision';
import { registerUploadRoutes } from './uploads';
import { createUploadStore } from './uploadStore';

// SKIPPED and INTERNAL_ERROR are terminal even when no task ran.
const TERMINAL_LIFE_CYCLE_STATES = new Set(['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR']);

export function createDesignerRuntime(client: WorkspaceClient, telemetry: ITelemetry) {
  const JOB_ID = process.env.DATABRICKS_JOB_ID?.trim() || undefined;
  const APP_ID = process.env.DATABRICKS_APP_ID?.trim() || process.env.DATABRICKS_CLIENT_ID?.trim();
  const appUrl = process.env.DATABRICKS_APP_URL;
  const report = (...args: unknown[]) =>
    telemetry.emit({
      severityNumber: SeverityNumber.ERROR,
      body: format(...args),
    });
  const appKitUploadStore = (storage: Parameters<typeof createUploadStore>[1]) => createUploadStore(client, storage);
  const appKitOutputFileStore = (volume: string) => createOutputFileStore(client, volume);

  // Runner/access checks consume the Jobs REST shape, including recorded parameter maps.
  async function readWorkspaceJson(
    path: string,
    query: Record<string, string | number | boolean | undefined>
  ): Promise<unknown> {
    const response = await client.request({
      method: 'GET',
      path,
      query: Object.fromEntries(
        Object.entries(query)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)])
      ),
    });
    return response.json();
  }

  const readJob = () => readWorkspaceJson('/api/2.2/jobs/get', { job_id: JOB_ID });
  const readRun = (runId: string | number) => readWorkspaceJson('/api/2.2/jobs/runs/get', { run_id: runId });

  const READ_RETRY_ATTEMPTS = 3;
  const READ_RETRY_BACKOFF_MS = 1000;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Only reads get application-level retries; writes rely on the SDK transport.
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

  const manifestLoader = createManifestLoader({ jobId: JOB_ID, readJob, readWorkspaceJson, report });
  const loadManifest = manifestLoader.load;

  const requestViewer = (req: Request) => viewerKey(req.get('x-forwarded-user'), JOB_ID);

  async function accessibleRun(
    run: unknown,
    req: Request,
    hydrate = false
  ): Promise<Record<string, unknown> | undefined> {
    if (!runBelongsToJob(run, JOB_ID)) return undefined;
    const manifest = await loadManifest();
    if (!manifest) return undefined;
    let detail = run;
    if (hydrate && isRecord(run) && !Array.isArray(run.job_parameters)) {
      const id = idString(run.run_id);
      if (!id) return undefined;
      detail = await readRun(id);
    }
    return isRecord(detail) &&
      !isLegacyExportRun(detail) &&
      runBelongsToJob(detail, JOB_ID) &&
      canAccessRun(detail, requestViewer(req))
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
      run = await retryRead(() => readRun(jobRunId));
    } catch (err) {
      res.status(502).json({
        error: `Could not read run ${jobRunId}: ${errorMessage(err)}`,
      });
      return undefined;
    }
    const visibleRun = await accessibleRun(run, req);
    if (visibleRun === undefined) {
      res.status(404).json({ error: `Run ${jobRunId} is not a run of this app.` });
      return undefined;
    }
    return { jobRunId, run: visibleRun };
  }

  async function declaredOutputs() {
    return (await loadManifest())?.blocks.filter((block): block is AppOutputBlock => block.type === 'output') ?? [];
  }

  // The runs/export CODE view carries the displayed command results.
  async function readRunExport(taskRunId: string): Promise<unknown> {
    const exported = await retryRead(() =>
      client.jobs.exportRun({
        runId: BigInt(taskRunId),
        viewsToExport: 'CODE',
      })
    );
    const views = isRecord(exported) && Array.isArray(exported.views) ? exported.views : [];
    // Probe with the decoder rather than a substring: a base64-wrapped view never contains the literal marker.
    const view: unknown = views.find(
      (candidate) => isRecord(candidate) && findNotebookModelValue(candidate.content) !== undefined
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
      failed ? retryRead(() => client.jobs.getRunOutput({ runId: BigInt(taskRunId) })) : Promise.resolve(undefined),
    ]).then(([exported, taskOutput]) => {
      const taskError = taskOutput.status === 'fulfilled' && isRecord(taskOutput.value) ? taskOutput.value : undefined;
      const taskErrorTexts = [taskError?.error, taskError?.errorTrace].filter(
        (text): text is string => typeof text === 'string'
      );
      const html = exported.status === 'fulfilled' ? exported.value : undefined;
      // Retention gaps and transient read errors can recover; do not retain them for the full cache TTL.
      if (exported.status === 'rejected' || taskOutput.status === 'rejected' || html === undefined) {
        const entry = completedTaskOutputs.get(key);
        if (entry?.value === value) entry.expiresAt = Date.now() + 5000;
      }
      return {
        payload: exportedModelToRunPayload(html, taskErrorTexts),
        failureReason: nonEmptyString(taskError?.error) ?? nonEmptyString(taskError?.errorTrace),
        ...(exported.status === 'rejected' ? { readError: errorMessage(exported.reason) } : {}),
      };
    });
    // Cache only after access checks, and share the in-flight read across concurrent viewers/pollers.
    completedTaskOutputs.set(key, {
      expiresAt: now + COMPLETED_RESULT_CACHE_TTL_MS,
      value,
    });
    while (completedTaskOutputs.size > COMPLETED_RESULT_CACHE_LIMIT) {
      const oldest = completedTaskOutputs.keys().next().value;
      if (oldest === undefined) break;
      completedTaskOutputs.delete(oldest);
    }
    return value;
  }

  async function readRunOutputPayload(taskRunId: string): Promise<string | undefined> {
    return (await readCompletedTaskOutput(taskRunId)).payload;
  }

  async function readRunResult(taskRunId: string | undefined, failed = false) {
    if (taskRunId === undefined) {
      return {
        outcome: 'noPayload',
        reason: 'The run reported no task, so it has no output to read.',
      };
    }
    try {
      // Jobs requires the task run ID here, not the job run ID.
      const { payload, failureReason, readError } = await readCompletedTaskOutput(taskRunId, failed);
      const result = matchRunOutputs(await declaredOutputs(), payload);
      return {
        ...result,
        ...(failureReason ? { failureReason } : {}),
        ...(result.outcome === 'noPayload' && readError
          ? { reason: `Could not read the run output: ${readError}` }
          : {}),
      };
    } catch (err) {
      return {
        outcome: 'noPayload',
        reason: `Could not read the run output: ${errorMessage(err)}`,
      };
    }
  }

  const LAST_RUN_PAGE_SIZE = 25;
  const SUCCESSFUL_RESULT_STATES = new Set(['SUCCESS', 'SUCCESS_WITH_FAILURES']);

  type ListRunsQuery = {
    active_only?: boolean;
    completed_only?: boolean;
    expand_tasks?: boolean;
    limit: number;
    page_token?: string;
  };

  async function collectVisibleRuns(
    req: Request,
    options: ListRunsQuery,
    isComplete: (visible: Record<string, unknown>[]) => boolean
  ): Promise<VisibleRunPage> {
    return scanVisibleRuns({
      pageToken: options.page_token,
      // The SDK iterator consumes page tokens internally; use its authenticated transport to
      // return a continuation when this request's scan budget is exhausted.
      readPage: (pageToken) =>
        readWorkspaceJson('/api/2.2/jobs/runs/list', {
          ...options,
          job_id: JOB_ID,
          page_token: pageToken,
        }),
      accessible: (run) => accessibleRun(run, req, true),
      isComplete,
    });
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
    run: Record<string, unknown>
  ): Pick<RunSummary, 'parameters' | 'parameterDisplayValues'> | undefined {
    if (!Array.isArray(run.job_parameters)) {
      return undefined;
    }
    const currentManifest = manifestLoader.current();
    const params: Record<string, string> = {};
    const displayValues: Record<string, string> = {};
    for (const [name, value] of Object.entries(runJobParameters(run))) {
      if (isReservedParameter(name) || !currentManifest?.parameters.some((parameter) => parameter.name === name)) {
        continue;
      }
      const isFile = currentManifest?.parameters.some(
        (parameter) => parameter.name === name && parameter.type === 'file'
      );
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

  function summarizeRunHistory(page: VisibleRunPage) {
    return {
      entries: [...page.runs].sort(newestFirst).flatMap((run) => summarizeHistoryRun(run) ?? []),
      hasMore: page.nextPageToken !== undefined,
      nextPageToken: page.nextPageToken,
    };
  }

  function resolveHistoryWindow(raw: unknown) {
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return RUN_HISTORY_DEFAULT_WINDOW;
    }
    return Math.min(parsed, RUN_HISTORY_MAX_WINDOW);
  }

  function registerRoutes(app: IAppRouter, route: (config: RouteConfig) => void) {
    // These responses contain per-viewer filenames and results, never shared cache entries.
    app.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      if (
        !isSameOriginBrowserRequest({
          origin: req.get('origin'),
          // Apps ingress can rewrite Host; the runtime URL names the public origin.
          appUrl: appUrl || `${req.protocol}://${req.get('host')}`,
          fetchSite: req.get('sec-fetch-site'),
        })
      ) {
        res.status(403).json({ error: 'Open the App directly to use its APIs.' });
        return;
      }
      next();
    });

    registerOutputFileRoutes(route, {
      jobId: JOB_ID,
      manifest: () => loadManifest(true),
      viewer: requestViewer,
      notebookPath: async () => {
        const paths = jobNotebookPaths(await readJob());
        return paths.length === 1 ? paths[0] : undefined;
      },
      getRun: readRun,
      readPayload: readRunOutputPayload,
      store: appKitOutputFileStore,
      report: (error) => report('Output file download failed', error),
    });

    registerUploadRoutes(route, {
      manifest: () => loadManifest(true),
      viewer: requestViewer,
      store: appKitUploadStore,
      report: (error) => report('Uploaded file download failed', error),
    });

    route({
      name: 'config',
      method: 'get',
      path: '/config',
      handler: async (_req, res) => {
        try {
          const manifest = await loadManifest(true);
          if (manifest === undefined) {
            res.json({
              manifest: null,
              runnable: false,
              notRunnableReason: 'noManifest',
            });
            return;
          }
          // Hidden runner defaults are execution policy, not consumer-visible configuration.
          const { runner: _runner, ...publicManifest } = manifest;
          if (JOB_ID === undefined) {
            res.json({
              manifest: publicManifest,
              runnable: false,
              notRunnableReason: 'noJob',
            });
            return;
          }
          const runnable = isPublishedRunner(manifest.runner, await readJob());
          res.json({
            manifest: publicManifest,
            runnable,
            ...(runnable ? {} : { notRunnableReason: 'updating' }),
          });
        } catch (err) {
          report('Designer request failed: %O', err);
          res.status(500).json({ error: 'The app could not read its own configuration.' });
        }
      },
    });

    route({
      name: 'lastRun',
      method: 'get',
      path: '/last-run',
      handler: async (req, res) => {
        if (JOB_ID === undefined) {
          res.json({ status: 'noJob' });
          return;
        }

        let listed: VisibleRunPage;
        try {
          // completed_only includes failures, so page until the newest success is in hand: a streak
          // of recent failures must not hide an older successful run.
          listed = await retryRead(() =>
            collectVisibleRuns(
              req,
              {
                completed_only: true,
                expand_tasks: true,
                limit: LAST_RUN_PAGE_SIZE,
                page_token: nonEmptyString(req.query.cursor),
              },
              (visible) => visible.some(isSuccessfulRun)
            )
          );
        } catch (err) {
          report('Designer request failed: %O', err);
          res.json({
            status: 'unavailable',
            reason: `Could not read this app's run history: ${errorMessage(err)}`,
          });
          return;
        }

        let active;
        try {
          // Trust active_only instead of duplicating Jobs lifecycle-state logic. Not retried: this
          // best-effort signal must not delay primary content.
          const activeRun = selectActiveRun(
            (
              await collectVisibleRuns(
                req,
                {
                  active_only: true,
                  expand_tasks: true,
                  limit: LAST_RUN_PAGE_SIZE,
                },
                (visible) => visible.length > 0
              )
            ).runs
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
          report('Designer request failed: %O', err);
        }

        const run = selectLastSuccessfulRun(listed.runs);
        const summary = run === undefined ? undefined : summarizeLastRun(run);
        if (run === undefined || summary === undefined) {
          res.json({
            status: listed.nextPageToken === undefined ? 'none' : 'searching',
            nextPageToken: listed.nextPageToken,
            ...(active === undefined ? {} : { active }),
          });
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
      },
    });

    route({
      name: 'run',
      method: 'post',
      path: '/run',
      handler: async (req, res) => {
        try {
          const manifest = await loadManifest(true);
          if (manifest === undefined) {
            res.status(409).json({
              error: 'This app has no published configuration, so it cannot run.',
            });
            return;
          }
          if (JOB_ID === undefined) {
            res.status(409).json({
              error: 'This app is not connected to a job yet, so it cannot run.',
            });
            return;
          }
          if (!APP_ID) {
            res.status(409).json({
              error: 'This app has no runtime App ID, so it cannot attribute Job runs.',
            });
            return;
          }
          if (!isPublishedRunner(manifest.runner, await readJob())) {
            res.status(409).json({ error: APP_UPDATING_MESSAGE });
            return;
          }
          const attribution = await runAttribution(req, APP_ID, async (token) =>
            createWorkspaceClient({
              host: await client.getHost(),
              token,
            }).currentUser.me({})
          );
          const userName = attribution?._lb_app_user_email;
          if (!attribution || !userName) {
            res.status(401).json({
              error: 'Sign in through Databricks Apps to run this app.',
            });
            return;
          }
          const submitted = isRecord(req.body) && isRecord(req.body.params) ? req.body.params : {};
          const resolved = await resolveRunParameters(
            manifest,
            submitted,
            requestViewer(req),
            appKitUploadStore(manifest.storage)
          );
          if (!resolved.ok) {
            res.status(400).json({
              error: resolved.error,
              ...(resolved.code ? { code: resolved.code } : {}),
            });
            return;
          }

          // The SDK can retry transient responses. Reuse the submission ID so those attempts
          // cannot start duplicate compute; the browser does not replay submissions.
          resolved.params[APP_REVISION_PARAM] = manifestRevision(manifest);
          const run = await client.jobs.runNow({
            jobId: BigInt(JOB_ID),
            idempotencyToken: attribution._lb_app_submission_id,
            jobParameters: { ...resolved.params, ...attribution },
          });
          const jobRunId = idString(run?.runId);
          if (jobRunId === undefined) {
            res.status(502).json({
              error: 'The platform accepted the request but returned no run id.',
            });
            return;
          }
          res.json({ jobRunId });
        } catch (err) {
          report('Designer request failed: %O', err);
          res.status(502).json({ error: `Could not start the run: ${errorMessage(err)}` });
        }
      },
    });

    route({
      name: 'runStatus',
      method: 'get',
      path: '/run/:jobRunId',
      handler: async (req, res) => {
        const found = await readViewerRun(req, res);
        if (found === undefined) return;
        const { jobRunId, run } = found;

        const lifeCycleState = lifeCycleStateOf(run);
        const resultState = resultStateOf(run);
        // A run carrying a result_state has finished even if its lifecycle value is absent or one
        // this list does not know yet, so treat that as terminal rather than polling it forever.
        const terminal =
          (lifeCycleState != null && TERMINAL_LIFE_CYCLE_STATES.has(lifeCycleState)) || resultState != null;
        const snapshot = {
          jobRunId,
          taskRunId: summarizeLastRun(run)?.taskRunId,
          lifeCycleState,
          resultState,
          stateMessage: isRecord(run.state) ? nonEmptyString(run.state.state_message) : undefined,
          setupDurationMs: run.setup_duration,
          executionDurationMs: run.execution_duration,
          runPageUrl: run.run_page_url,
          terminal,
          ...runParameterData(run),
        };

        if (!terminal) {
          res.json(snapshot);
          return;
        }

        const failed = resultState === undefined || !SUCCESSFUL_RESULT_STATES.has(resultState);
        res.json({
          ...snapshot,
          result: await readRunResult(snapshot.taskRunId, failed),
        });
      },
    });

    route({
      name: 'cancelRun',
      method: 'delete',
      path: '/run/:jobRunId',
      handler: async (req, res) => {
        const found = await readViewerRun(req, res);
        if (found === undefined) return;
        try {
          // Polling settles cancellation from the run's own state.
          await client.jobs.cancelRun({ runId: BigInt(found.jobRunId) });
          res.json({ cancelled: true });
        } catch (err) {
          report('Designer request failed: %O', err);
          res.status(502).json({
            error: `Could not cancel run ${found.jobRunId}: ${errorMessage(err)}`,
          });
        }
      },
    });

    route({
      name: 'runs',
      method: 'get',
      path: '/runs',
      handler: async (req, res) => {
        if (JOB_ID === undefined) {
          res.json({ status: 'noJob' });
          return;
        }
        const windowSize = resolveHistoryWindow(req.query?.window);

        let history: VisibleRunPage;
        try {
          history = await retryRead(() =>
            collectVisibleRuns(
              req,
              {
                completed_only: true,
                limit: RUN_HISTORY_PAGE_SIZE,
                page_token: nonEmptyString(req.query.cursor),
              },
              (visible) => visible.length >= windowSize
            )
          );
        } catch (err) {
          report('Designer request failed: %O', err);
          res.json({
            status: 'unavailable',
            reason: `Could not read this app's run history: ${errorMessage(err)}`,
          });
          return;
        }

        const page = summarizeRunHistory(history);
        res.json({
          status: 'found',
          runs: page.entries,
          hasMore: page.hasMore,
          nextPageToken: page.nextPageToken,
          window: windowSize,
        });
      },
    });
  }
  return {
    registerRoutes,
    close() {
      manifestLoader.clear();
      completedTaskOutputs.clear();
    },
  };
}
