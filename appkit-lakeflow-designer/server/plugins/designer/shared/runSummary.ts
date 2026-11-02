import { idString, isRecord, nonEmptyString, positiveInt, stringValues } from './values.ts';

export type RunSummary = {
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

export type LastRunSummary = Omit<RunSummary, 'lifeCycleState' | 'parameters' | 'parameterDisplayValues'>;
export type RunHistoryEntry = Omit<RunSummary, 'taskRunId'>;
export type ActiveRun = Pick<RunSummary, 'lifeCycleState' | 'parameters' | 'parameterDisplayValues'> & {
  run: LastRunSummary;
};

function parseRunSummary(raw: unknown): RunSummary | undefined {
  if (!isRecord(raw)) return undefined;
  const jobRunId = idString(raw.jobRunId);
  if (jobRunId === undefined) return undefined;
  const summary: RunSummary = { jobRunId };
  const taskRunId = idString(raw.taskRunId);
  if (taskRunId !== undefined) summary.taskRunId = taskRunId;
  for (const field of ['endTime', 'startTime', 'setupDurationMs', 'executionDurationMs'] as const) {
    const value = positiveInt(raw[field]);
    if (value !== undefined) summary[field] = value;
  }
  for (const field of ['runPageUrl', 'resultState', 'lifeCycleState'] as const) {
    const value = nonEmptyString(raw[field]);
    if (value !== undefined) summary[field] = value;
  }
  for (const field of ['parameters', 'parameterDisplayValues'] as const) {
    const value = stringValues(raw[field]);
    if (value !== undefined) summary[field] = value;
  }
  return summary;
}

export function parseLastRunSummary(raw: unknown): LastRunSummary | undefined {
  const parsed = parseRunSummary(raw);
  if (!parsed) return undefined;
  const { lifeCycleState: _state, parameters: _params, parameterDisplayValues: _labels, ...summary } = parsed;
  return summary;
}

export function parseRunHistoryEntry(raw: unknown): RunHistoryEntry | undefined {
  const parsed = parseRunSummary(raw);
  if (!parsed) return undefined;
  const { taskRunId: _task, ...entry } = parsed;
  return entry;
}

export function parseActiveRun(raw: unknown): ActiveRun | undefined {
  if (!isRecord(raw)) return undefined;
  const run = parseLastRunSummary(raw.run);
  if (run === undefined) return undefined;
  const parameters = stringValues(raw.parameters);
  const parameterDisplayValues = stringValues(raw.parameterDisplayValues);
  const lifeCycleState = nonEmptyString(raw.lifeCycleState);
  return {
    run,
    ...(parameters === undefined ? {} : { parameters }),
    ...(parameterDisplayValues === undefined ? {} : { parameterDisplayValues }),
    ...(lifeCycleState === undefined ? {} : { lifeCycleState }),
  };
}
