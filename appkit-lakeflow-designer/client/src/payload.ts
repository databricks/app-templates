import { DISPLAY_ROW_LIMIT, summarizeResultPreview, type ResultPreview } from '../../shared/resultPreview';
import type { AppChartSpec } from '../../shared/appManifest';
import { MAX_OUTPUT_FILES, parseFileOutputBehavior, type FileOutputBehavior, type WrittenFile } from '../../shared/fileOutputs';

export type SchemaField = {
  name: string;

  type: string;
  nullable: boolean;
};

export type ResultRow = Record<string, unknown>;

export type RunMetrics = {
  collect_ms?: number;
  serialize_ms?: number;
  rows_returned?: number;
  total_ms?: number;
};

export type OkPayload = ResultPreview & {
  status: 'ok';
  target_node: string;
  target_port: string;
  schema: SchemaField[];
  rows: ResultRow[];
  metrics: RunMetrics;
};

export type ErrorPayload = {
  status: 'error';
  target_node: string;
  error: { type: string; message: string; traceback_tail?: string };
  metrics: RunMetrics;
};

export type OutputOutcome =
  | { outcome: 'result'; payload: OkPayload }
  | { outcome: 'computeError'; payload: ErrorPayload }

  | { outcome: 'malformed'; reason: string }

  | { outcome: 'missing'; reason: string };

export type MatchedOutput = {

  key: string;

  id?: string;

  title: string;

  source?: string;

  chartSpec?: AppChartSpec;
  files?: WrittenFile[];
  fileBehavior?: FileOutputBehavior;

  outcome: OutputOutcome;
};

export type RunOutcome =

  | { outcome: 'outputs'; outputs: MatchedOutput[] }

  | { outcome: 'noPayload'; reason: string };

export type RunSnapshot = {
  jobRunId: string;
  taskRunId?: string;

  lifeCycleState?: string;
  resultState?: string;
  stateMessage?: string;
  setupDurationMs?: number;
  executionDurationMs?: number;
  runPageUrl?: string;
  terminal: boolean;
  parameters?: Record<string, string>;
  parameterDisplayValues?: Record<string, string>;

  result?: RunOutcome;
};

export type TriggerResponse = { jobRunId: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const positiveInt = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

// Run and job IDs are int64 carried as decimal strings; keep them as strings, never through Number.
const idString = (value: unknown): string | undefined => {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return undefined;
  }
  const text = String(value);
  return /^[1-9][0-9]*$/.test(text) ? text : undefined;
};

function parseSchemaField(raw: unknown): SchemaField | undefined {
  if (!isRecord(raw) || typeof raw.name !== 'string' || typeof raw.type !== 'string') {
    return undefined;
  }
  return { name: raw.name, type: raw.type, nullable: typeof raw.nullable === 'boolean' ? raw.nullable : true };
}

function parseMetrics(raw: unknown): RunMetrics {
  if (!isRecord(raw)) {
    return {};
  }
  const metrics: RunMetrics = {};
  if (typeof raw.collect_ms === 'number') metrics.collect_ms = raw.collect_ms;
  if (typeof raw.serialize_ms === 'number') metrics.serialize_ms = raw.serialize_ms;
  if (typeof raw.rows_returned === 'number') metrics.rows_returned = raw.rows_returned;
  if (typeof raw.total_ms === 'number') metrics.total_ms = raw.total_ms;
  return metrics;
}

function parseOkPayload(raw: Record<string, unknown>): OkPayload | undefined {
  if (typeof raw.target_node !== 'string' || typeof raw.target_port !== 'string') {
    return undefined;
  }
  if (!Array.isArray(raw.schema) || !Array.isArray(raw.rows) || !raw.rows.every(isRecord)) {
    return undefined;
  }
  const schema = raw.schema.map(parseSchemaField);
  if (schema.some((field) => field === undefined)) {
    return undefined;
  }
  return {
    status: 'ok',
    target_node: raw.target_node,
    target_port: raw.target_port,
    schema: schema as SchemaField[],
    rows: raw.rows.slice(0, DISPLAY_ROW_LIMIT),
    ...summarizeResultPreview(raw.rows.length, raw.truncated, raw.total_row_count),
    metrics: parseMetrics(raw.metrics),
  };
}

function parseErrorPayload(raw: Record<string, unknown>): ErrorPayload | undefined {
  if (typeof raw.target_node !== 'string' || !isRecord(raw.error)) {
    return undefined;
  }
  const error = raw.error;
  if (typeof error.type !== 'string' || typeof error.message !== 'string') {
    return undefined;
  }
  return {
    status: 'error',
    target_node: raw.target_node,
    error: {
      type: error.type,
      message: error.message,
      ...(typeof error.traceback_tail === 'string' ? { traceback_tail: error.traceback_tail } : {}),
    },
    metrics: parseMetrics(raw.metrics),
  };
}

function parseOutputOutcome(raw: unknown): OutputOutcome | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (raw.outcome === 'result') {
    const payload = isRecord(raw.payload) ? parseOkPayload(raw.payload) : undefined;
    return payload === undefined
      ? { outcome: 'malformed', reason: 'This output reported success but its payload was unreadable.' }
      : { outcome: 'result', payload };
  }
  if (raw.outcome === 'computeError') {
    const payload = isRecord(raw.payload) ? parseErrorPayload(raw.payload) : undefined;
    return payload === undefined
      ? { outcome: 'malformed', reason: 'This output reported an error that was unreadable.' }
      : { outcome: 'computeError', payload };
  }
  if (raw.outcome === 'malformed' || raw.outcome === 'missing') {
    return { outcome: raw.outcome, reason: typeof raw.reason === 'string' ? raw.reason : 'This output could not be read.' };
  }
  return undefined;
}

function parseMatchedOutput(raw: unknown, index: number): MatchedOutput | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const outcome = parseOutputOutcome(raw.outcome);
  if (outcome === undefined) {
    return undefined;
  }
  const id = nonEmptyString(raw.id);
  const fileBehavior = parseFileOutputBehavior(raw.fileBehavior);
  return {
    key: nonEmptyString(raw.key) ?? `output:${index}`,
    ...(id === undefined ? {} : { id }),
    title: nonEmptyString(raw.title) ?? id ?? `Output ${index + 1}`,
    ...(nonEmptyString(raw.source) === undefined ? {} : { source: nonEmptyString(raw.source) }),
    ...(isRecord(raw.chartSpec) ? { chartSpec: raw.chartSpec as AppChartSpec } : {}),
    ...(Array.isArray(raw.files) && raw.files.length <= MAX_OUTPUT_FILES &&
      raw.files.every((file) => isRecord(file) && typeof file.path === 'string' && file.path.startsWith('/Volumes/'))
      ? { files: raw.files.map((file) => ({ path: file.path as string })) }
      : {}),
    ...(fileBehavior ? { fileBehavior } : {}),
    outcome,
  };
}

// Validate a server run result rather than casting it: a malformed /run or /last-run response must
// degrade to a readable outcome instead of reaching the render tree with missing rows/schema fields.
export function parseRunOutcome(raw: unknown): RunOutcome | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (raw.outcome === 'noPayload') {
    return { outcome: 'noPayload', reason: typeof raw.reason === 'string' ? raw.reason : 'The run returned no output.' };
  }
  if (raw.outcome !== 'outputs' || !Array.isArray(raw.outputs)) {
    return undefined;
  }
  const outputs = raw.outputs.map(parseMatchedOutput);
  if (outputs.some((output) => output === undefined)) {
    return undefined;
  }
  return { outcome: 'outputs', outputs: outputs as MatchedOutput[] };
}

export function parseRunSnapshot(raw: unknown): RunSnapshot | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const jobRunId = idString(raw.jobRunId);
  if (jobRunId === undefined) {
    return undefined;
  }
  const snapshot: RunSnapshot = { jobRunId, terminal: raw.terminal === true };
  const taskRunId = idString(raw.taskRunId);
  if (taskRunId !== undefined) snapshot.taskRunId = taskRunId;
  const lifeCycleState = nonEmptyString(raw.lifeCycleState);
  if (lifeCycleState !== undefined) snapshot.lifeCycleState = lifeCycleState;
  const resultState = nonEmptyString(raw.resultState);
  if (resultState !== undefined) snapshot.resultState = resultState;
  const stateMessage = nonEmptyString(raw.stateMessage);
  if (stateMessage !== undefined) snapshot.stateMessage = stateMessage;
  const setupDurationMs = positiveInt(raw.setupDurationMs);
  if (setupDurationMs !== undefined) snapshot.setupDurationMs = setupDurationMs;
  const executionDurationMs = positiveInt(raw.executionDurationMs);
  if (executionDurationMs !== undefined) snapshot.executionDurationMs = executionDurationMs;
  const runPageUrl = nonEmptyString(raw.runPageUrl);
  if (runPageUrl !== undefined) snapshot.runPageUrl = runPageUrl;
  for (const field of ['parameters', 'parameterDisplayValues'] as const) {
    const values = raw[field];
    if (isRecord(values)) {
      snapshot[field] = Object.fromEntries(
        Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    }
  }
  const result = raw.result === undefined ? undefined : parseRunOutcome(raw.result);
  if (result !== undefined) snapshot.result = result;
  return snapshot;
}
