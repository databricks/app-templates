
import type { RunOutcome } from './payload';
import { parseRunOutcome } from './payload';
import { LAST_RUN_ROUTE } from './routes';

export type LastRunSummary = {
  jobRunId: string;
  taskRunId?: string;

  endTime?: number;
  startTime?: number;
  setupDurationMs?: number;
  executionDurationMs?: number;
  runPageUrl?: string;
  resultState?: string;
};

export type ActiveRun = {
  run: LastRunSummary;
  parameters?: Record<string, string>;
  parameterDisplayValues?: Record<string, string>;
  lifeCycleState?: string;
};

export type LastRunState =
  | { status: 'loading' }

  | { status: 'noJob' }

  | { status: 'none'; active?: ActiveRun }

  | { status: 'unavailable'; reason: string }
  | {
      status: 'found';
      run: LastRunSummary;

      parameters?: Record<string, string>;
      parameterDisplayValues?: Record<string, string>;
      result: RunOutcome;
      active?: ActiveRun;
    };

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

function parseSummary(raw: unknown): LastRunSummary | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const jobRunId = idString(raw.jobRunId);
  if (jobRunId === undefined) {
    return undefined;
  }
  return {
    jobRunId,
    ...(idString(raw.taskRunId) === undefined ? {} : { taskRunId: idString(raw.taskRunId) }),
    ...(positiveInt(raw.endTime) === undefined ? {} : { endTime: positiveInt(raw.endTime) }),
    ...(positiveInt(raw.startTime) === undefined ? {} : { startTime: positiveInt(raw.startTime) }),
    ...(positiveInt(raw.setupDurationMs) === undefined ? {} : { setupDurationMs: positiveInt(raw.setupDurationMs) }),
    ...(positiveInt(raw.executionDurationMs) === undefined
      ? {}
      : { executionDurationMs: positiveInt(raw.executionDurationMs) }),
    ...(typeof raw.runPageUrl === 'string' && raw.runPageUrl !== '' ? { runPageUrl: raw.runPageUrl } : {}),
    ...(typeof raw.resultState === 'string' && raw.resultState !== '' ? { resultState: raw.resultState } : {}),
  };
}

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

function parseActive(raw: unknown): ActiveRun | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const run = parseSummary(raw.run);
  if (run === undefined) {
    return undefined;
  }
  const parameters = parseParameters(raw.parameters);
  const parameterDisplayValues = parseParameters(raw.parameterDisplayValues);
  return {
    run,
    ...(parameters === undefined ? {} : { parameters }),
    ...(parameterDisplayValues === undefined ? {} : { parameterDisplayValues }),
    ...(typeof raw.lifeCycleState === 'string' && raw.lifeCycleState !== ''
      ? { lifeCycleState: raw.lifeCycleState }
      : {}),
  };
}

export async function fetchLastRun(): Promise<LastRunState> {
  try {
    const response = await fetch(LAST_RUN_ROUTE);
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
    const active = parseActive(body.active);
    if (body.status === 'none') {

      return { status: 'none', ...(active === undefined ? {} : { active }) };
    }
    if (body.status === 'unavailable') {
      return { status: 'unavailable', reason: typeof body.reason === 'string' ? body.reason : 'unknown reason' };
    }
    const run = parseSummary(body.run);
    const result = parseRunOutcome(body.result);
    if (body.status !== 'found' || run === undefined || result === undefined) {
      return { status: 'unavailable', reason: 'the server returned an unreadable last run' };
    }
    return {
      status: 'found',
      run,
      ...(parseParameters(body.parameters) === undefined ? {} : { parameters: parseParameters(body.parameters) }),
      ...(parseParameters(body.parameterDisplayValues) === undefined
        ? {}
        : { parameterDisplayValues: parseParameters(body.parameterDisplayValues) }),
      result,
      ...(active === undefined ? {} : { active }),
    };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}
