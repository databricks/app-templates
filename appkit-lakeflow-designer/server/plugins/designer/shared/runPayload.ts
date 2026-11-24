import { isHtmlOutput } from './htmlOutputs.ts';
import { DISPLAY_ROW_LIMIT, summarizeResultPreview, type ResultPreview } from './resultPreview.ts';
import type { AppChartSpec } from './appManifest.ts';
import { MAX_OUTPUT_FILES, parseFileOutputBehavior, type FileOutputBehavior, type WrittenFile } from './fileOutputs.ts';
import { idString, isRecord, nonEmptyString, positiveInt, stringValues } from './values.ts';
import { parseRunDiagnostics, type RunDiagnostics } from './guardrails.ts';
import type { RunSummary } from './runSummary.ts';

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
  | { outcome: 'html'; html: string }
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
  disabled?: boolean;
  outcome: OutputOutcome;
};

export type RunOutcome = ({ outcome: 'outputs'; outputs: MatchedOutput[] } | { outcome: 'noPayload'; reason: string }) &
  RunDiagnostics;

export type RunSnapshot = Pick<
  RunSummary,
  | 'jobRunId'
  | 'taskRunId'
  | 'lifeCycleState'
  | 'resultState'
  | 'setupDurationMs'
  | 'executionDurationMs'
  | 'runPageUrl'
  | 'parameters'
  | 'parameterDisplayValues'
> & {
  stateMessage?: string;
  terminal: boolean;
  result?: RunOutcome;
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
  if (!schema.every((field) => field !== undefined)) {
    return undefined;
  }
  return {
    status: 'ok',
    target_node: raw.target_node,
    target_port: raw.target_port,
    schema,
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
  if (raw.outcome === 'html') {
    return isHtmlOutput(raw.html)
      ? { outcome: 'html', html: raw.html }
      : { outcome: 'malformed', reason: 'This HTML output is invalid or too large.' };
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
    return {
      outcome: raw.outcome,
      reason: typeof raw.reason === 'string' ? raw.reason : 'This output could not be read.',
    };
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
  const source = nonEmptyString(raw.source);
  const fileBehavior = parseFileOutputBehavior(raw.fileBehavior);
  return {
    key: nonEmptyString(raw.key) ?? `output:${index}`,
    ...(id === undefined ? {} : { id }),
    title: nonEmptyString(raw.title) ?? id ?? `Output ${index + 1}`,
    ...(source === undefined ? {} : { source }),
    ...(isRecord(raw.chartSpec) ? { chartSpec: raw.chartSpec as AppChartSpec } : {}),
    ...(Array.isArray(raw.files) &&
    raw.files.length <= MAX_OUTPUT_FILES &&
    raw.files.every(
      (file): file is { path: string } =>
        isRecord(file) && typeof file.path === 'string' && file.path.startsWith('/Volumes/')
    )
      ? { files: raw.files.map((file) => ({ path: file.path })) }
      : {}),
    ...(fileBehavior ? { fileBehavior } : {}),
    ...(typeof raw.disabled === 'boolean' ? { disabled: raw.disabled } : {}),
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
    return {
      outcome: 'noPayload',
      reason: typeof raw.reason === 'string' ? raw.reason : 'The run returned no output.',
      ...parseRunDiagnostics(raw),
    };
  }
  if (raw.outcome !== 'outputs' || !Array.isArray(raw.outputs)) {
    return undefined;
  }
  const outputs = raw.outputs.map(parseMatchedOutput);
  if (!outputs.every((output) => output !== undefined)) {
    return undefined;
  }
  return { outcome: 'outputs', outputs, ...parseRunDiagnostics(raw) };
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
    const values = stringValues(raw[field]);
    if (values !== undefined) snapshot[field] = values;
  }
  const result = parseRunOutcome(raw.result);
  if (result !== undefined) snapshot.result = result;
  return snapshot;
}
