
import type { RunOutcome, RunSnapshot } from './payload';
import { parseRunOutcome, parseRunSnapshot } from './payload';
import { runHistoryRoute, runStatusRoute } from './routes';

export type RunHistoryEntry = {
  jobRunId: string;

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

export type RunHistoryState =
  | { status: 'loading' }

  | { status: 'noJob' }

  | { status: 'unavailable'; reason: string }
  | {
      status: 'found';

      runs: RunHistoryEntry[];

      hasMore: boolean;

      window: number;
    };

export const RUN_HISTORY_FIRST_WINDOW = 100;

const SUCCESSFUL_RESULT_STATES = new Set(['SUCCESS', 'SUCCESS_WITH_FAILURES']);

const TERMINAL_UNSUCCESSFUL_RESULT_STATES = new Set([
  'FAILED',
  'TIMEDOUT',
  'CANCELED',
  'MAXIMUM_CONCURRENT_RUNS_REACHED',
  'UPSTREAM_CANCELED',
  'UPSTREAM_FAILED',
  'EXCLUDED',
  'EVICTED',
  'UPSTREAM_EVICTED',
  'DISABLED',
]);

export function isSuccessfulResultState(resultState: string | undefined): boolean {
  return resultState !== undefined && SUCCESSFUL_RESULT_STATES.has(resultState);
}

export function hasNewerUnsuccessfulRun(runs: RunHistoryEntry[], lastSuccessfulEndTime: number | undefined): boolean {
  if (lastSuccessfulEndTime === undefined) {
    return false;
  }
  return runs.some(
    (run) =>
      run.endTime !== undefined &&
      run.endTime > lastSuccessfulEndTime &&
      run.resultState !== undefined &&
      TERMINAL_UNSUCCESSFUL_RESULT_STATES.has(run.resultState),
  );
}

export function historyEntriesWithDisplayedRun(
  runs: RunHistoryEntry[],
  displayedRun: RunHistoryEntry | undefined,
): RunHistoryEntry[] {
  if (displayedRun === undefined) {
    return runs;
  }
  const matchingIndex = runs.findIndex((run) => run.jobRunId === displayedRun.jobRunId);
  if (matchingIndex >= 0) {
    return runs.map((run, index) => (index === matchingIndex ? { ...displayedRun, ...run } : run));
  }
  const displayedTime = displayedRun.startTime ?? displayedRun.endTime;
  if (displayedTime === undefined) {
    return [displayedRun, ...runs];
  }
  const insertionIndex = runs.findIndex((run) => displayedTime > (run.startTime ?? run.endTime ?? 0));
  if (insertionIndex < 0) {
    return [...runs, displayedRun];
  }
  return [...runs.slice(0, insertionIndex), displayedRun, ...runs.slice(insertionIndex)];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positiveInt = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

// Run and job IDs are int64: the server sends them as decimal strings, so keep them as strings
// rather than routing through Number, which corrupts anything past 2^53-1.
const idString = (value: unknown): string | undefined => {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return undefined;
  }
  const text = String(value);
  return /^[1-9][0-9]*$/.test(text) ? text : undefined;
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

function parseParameters(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      params[name] = value;
    }
  }
  return params;
}

function parseEntry(raw: unknown): RunHistoryEntry | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const jobRunId = idString(raw.jobRunId);
  if (jobRunId === undefined) {
    return undefined;
  }
  const parameters = parseParameters(raw.parameters);
  const parameterDisplayValues = parseParameters(raw.parameterDisplayValues);
  return {
    jobRunId,
    ...(positiveInt(raw.endTime) === undefined ? {} : { endTime: positiveInt(raw.endTime) }),
    ...(positiveInt(raw.startTime) === undefined ? {} : { startTime: positiveInt(raw.startTime) }),
    ...(positiveInt(raw.setupDurationMs) === undefined ? {} : { setupDurationMs: positiveInt(raw.setupDurationMs) }),
    ...(positiveInt(raw.executionDurationMs) === undefined
      ? {}
      : { executionDurationMs: positiveInt(raw.executionDurationMs) }),
    ...(nonEmptyString(raw.runPageUrl) === undefined ? {} : { runPageUrl: nonEmptyString(raw.runPageUrl) }),
    ...(nonEmptyString(raw.resultState) === undefined ? {} : { resultState: nonEmptyString(raw.resultState) }),
    ...(nonEmptyString(raw.lifeCycleState) === undefined ? {} : { lifeCycleState: nonEmptyString(raw.lifeCycleState) }),
    ...(parameters === undefined ? {} : { parameters }),
    ...(parameterDisplayValues === undefined ? {} : { parameterDisplayValues }),
  };
}

export async function fetchRunHistory(windowSize: number): Promise<RunHistoryState> {
  try {
    const response = await fetch(runHistoryRoute(windowSize));
    if (!response.ok) {
      return { status: 'unavailable', reason: `the server returned ${response.status}` };
    }
    const body: unknown = await response.json();
    if (!isRecord(body)) {
      return { status: 'unavailable', reason: 'the server returned an unreadable response' };
    }
    if (body.status === 'noJob') {
      return { status: 'noJob' };
    }
    if (body.status === 'unavailable') {
      return { status: 'unavailable', reason: nonEmptyString(body.reason) ?? 'unknown reason' };
    }
    if (body.status !== 'found' || !Array.isArray(body.runs)) {

      return { status: 'unavailable', reason: 'the server returned an unreadable run history' };
    }
    const runs = body.runs.map(parseEntry).filter((entry): entry is RunHistoryEntry => entry !== undefined);
    return {
      status: 'found',
      runs,
      hasMore: body.hasMore === true,

      window: positiveInt(body.window) ?? windowSize,
    };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}

export type SelectedRunState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'found'; outcome: RunOutcome; snapshot: RunSnapshot };

export async function fetchRunResult(jobRunId: string): Promise<SelectedRunState> {
  try {
    const response = await fetch(runStatusRoute(jobRunId));
    if (response.status === 404) {
      return { status: 'unavailable', reason: `Run ${jobRunId} is not a run of this app.` };
    }
    if (!response.ok) {
      return { status: 'unavailable', reason: `the server returned ${response.status}` };
    }
    const body: unknown = await response.json();
    if (!isRecord(body)) {
      return { status: 'unavailable', reason: 'the server returned an unreadable response' };
    }
    const outcome = parseRunOutcome(body.result);
    const snapshot = parseRunSnapshot(body);
    if (outcome === undefined || snapshot === undefined) {
      return { status: 'unavailable', reason: 'the run reported no readable result' };
    }
    return {
      status: 'found',
      outcome,
      snapshot,
    };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}
