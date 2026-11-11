import { outputBlockTitle, type AppOutputBlock } from '../shared/appManifest';
import type { FileOutputBehavior } from '../shared/fileOutputs';
import { parseRunDiagnostics, type RunDiagnostics } from '../shared/guardrails';
import { isHtmlOutput } from '../shared/htmlOutputs';
import { errorMessage, isRecord, nonEmptyString } from '../shared/values';
import { recordedFileOutput } from './outputFiles';

const NO_OUTPUT_REASON = 'The run finished but returned no output. The notebook did not call dbutils.notebook.exit().';
const NO_OUTPUTS_REASON =
  'The run finished but returned a payload with no outputs. The notebook was published with nothing to return.';
const MISSING_OUTPUT_REASON =
  'This output is published with the app, but the run did not return it. That happens when the run predates the output being added, or when the app and its runner have drifted apart.';

const isReadableError = (value: unknown): value is { type: string; message: string } =>
  isRecord(value) && typeof value.type === 'string' && typeof value.message === 'string';
const isSchemaField = (value: unknown): value is { name: string; type: string } =>
  isRecord(value) && typeof value.name === 'string' && typeof value.type === 'string';

type ClassifiedEntry =
  | {
      outcome: 'malformed';
      index: number;
      id: string | undefined;
      reason: string;
    }
  | {
      outcome: 'computeError' | 'result' | 'html';
      index: number;
      id: string | undefined;
      payload: Record<string, unknown>;
    };

function classifyOutputEntry(entry: unknown, index: number): ClassifiedEntry {
  if (!isRecord(entry)) {
    return {
      outcome: 'malformed',
      index,
      id: undefined,
      reason: 'This output is not an object.',
    };
  }
  const id = nonEmptyString(entry.id);
  const malformed = (reason: string): ClassifiedEntry => ({
    outcome: 'malformed',
    index,
    id,
    reason,
  });
  if (entry.status === 'error') {
    return isReadableError(entry.error)
      ? { outcome: 'computeError', index, id, payload: entry }
      : malformed('This output reported an error, but the error was not readable.');
  }
  if (entry.status !== 'ok') {
    return malformed(`This output has an unrecognised status: ${JSON.stringify(entry.status)}`);
  }
  if (entry.kind === 'html') {
    return isHtmlOutput(entry.html) && typeof entry.target_node === 'string' && entry.target_port === undefined
      ? { outcome: 'html', index, id, payload: entry }
      : malformed('This HTML output is invalid or too large.');
  }
  if (!Array.isArray(entry.schema) || !Array.isArray(entry.rows)) {
    return malformed('This output reported success but is missing the schema or rows.');
  }
  if (!entry.schema.every(isSchemaField) || !entry.rows.every(isRecord)) {
    return malformed('This output reported success but its schema or rows are malformed.');
  }
  const fieldNames = entry.schema.map((field) => field.name);
  // Rows are keyed by column name downstream, so blank or duplicate names silently collapse
  // columns; reject the output rather than render data that has lost or merged a column.
  if (fieldNames.some((name) => name === '') || new Set(fieldNames).size !== fieldNames.length) {
    return malformed('This output reported success but its columns have blank or duplicate names.');
  }
  return { outcome: 'result', index, id, payload: entry };
}

function classifyMultiRunOutput(raw: string | undefined): (
  | { outcome: 'noPayload'; reason: string }
  | {
      outcome: 'outputs';
      outputs: ClassifiedEntry[];
      runtimeNodeStates: Map<string, boolean>;
    }
) &
  RunDiagnostics {
  if (raw === undefined || raw.trim() === '') {
    return { outcome: 'noPayload', reason: NO_OUTPUT_REASON };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      outcome: 'noPayload',
      reason: `The run returned output that is not valid JSON: ${errorMessage(err)}`,
    };
  }
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
    return {
      outcome: 'noPayload',
      reason: 'The run returned an empty output object.',
    };
  }
  const diagnostics = parseRunDiagnostics(parsed);
  if (!Array.isArray(parsed.outputs)) {
    return {
      ...diagnostics,
      outcome: 'noPayload',
      reason: 'The run returned output with no outputs list, so it is not a multi-output payload.',
    };
  }
  const runtimeNodeStates = new Map<string, boolean>();
  if (isRecord(parsed.runtimeNodeStates)) {
    for (const [nodeId, state] of Object.entries(parsed.runtimeNodeStates)) {
      if (nodeId !== '' && isRecord(state) && typeof state.disabled === 'boolean') {
        runtimeNodeStates.set(nodeId, state.disabled);
      }
    }
  }
  if (parsed.outputs.length === 0 && runtimeNodeStates.size === 0) {
    return { outcome: 'noPayload', reason: NO_OUTPUTS_REASON, ...diagnostics };
  }
  // Classify entries independently so one malformed output does not discard valid siblings.
  return {
    outcome: 'outputs',
    outputs: parsed.outputs.map((entry, index) => classifyOutputEntry(entry, index)),
    runtimeNodeStates,
    ...diagnostics,
  };
}

const joinSource = (node: string | undefined, port: string | undefined): string | undefined =>
  node === undefined ? undefined : port === undefined ? node : `${node}.${port}`;

type MatchOutcome =
  | { outcome: 'malformed'; reason: string }
  | { outcome: 'computeError' | 'result'; payload: Record<string, unknown> }
  | { outcome: 'html'; html: string }
  | { outcome: 'missing'; reason: string };
type OutputSection = {
  key: string;
  id?: string;
  title: string;
  source?: string;
  chartSpec?: Record<string, unknown>;
  files?: { path: string }[];
  fileBehavior?: FileOutputBehavior;
  disabled?: boolean;
  outcome: MatchOutcome;
};

function matchedOutcome(entry: ClassifiedEntry): MatchOutcome {
  if (entry.outcome === 'html') {
    return isHtmlOutput(entry.payload.html)
      ? { outcome: 'html', html: entry.payload.html }
      : {
          outcome: 'malformed',
          reason: 'This HTML output is invalid or too large.',
        };
  }
  return entry.outcome === 'malformed'
    ? { outcome: 'malformed', reason: entry.reason }
    : { outcome: entry.outcome, payload: entry.payload };
}

export function matchRunOutputs(declared: AppOutputBlock[], raw: string | undefined) {
  const multi = classifyMultiRunOutput(raw);
  const diagnostics = parseRunDiagnostics(multi);
  if (multi.outcome !== 'outputs' && !declared.some((block) => block.fileOutput || block.disabled === true)) {
    return { outcome: 'noPayload', reason: multi.reason, ...diagnostics };
  }
  const classified = multi.outcome === 'outputs' ? multi.outputs : [];
  const runtimeNodeStates = multi.outcome === 'outputs' ? multi.runtimeNodeStates : undefined;
  const consumed = new Set<number>();

  // The run may include other nodes and ports, but only published output blocks are exposed.
  const outputs: OutputSection[] = declared.map((output) => {
    // Entries are keyed by the (node, port) of the cell's display(ctx[...]) line, not an output id.
    // Payload empties read as undefined, so normalize declared empties the same way.
    const declaredNode = output.nodeId === '' ? undefined : output.nodeId;
    const declaredPort = output.port === '' ? undefined : output.port;
    // A malformed entry has no (node, port), so it binds to its block by id and surfaces as malformed.
    const matches = (entry: ClassifiedEntry) =>
      entry.outcome === 'malformed'
        ? entry.id !== undefined && entry.id === output.id
        : nonEmptyString(entry.payload.target_node) === declaredNode &&
          (entry.payload.kind === 'html') === (output.kind === 'html') &&
          nonEmptyString(entry.payload.target_port) === declaredPort;
    // Prefer an unconsumed entry; blocks published at the same (node, port) may share one.
    const found = classified.find((entry) => !consumed.has(entry.index) && matches(entry)) ?? classified.find(matches);
    const source = joinSource(declaredNode, declaredPort);
    const fileReceipt = output.fileOutput ? recordedFileOutput(raw, output.nodeId, output.fileOutput) : undefined;
    const ownDisabled = runtimeNodeStates?.get(output.nodeId) ?? output.disabled;
    const groupDisabled = output.parentGroupId === undefined ? undefined : runtimeNodeStates?.get(output.parentGroupId);
    const disabled =
      ownDisabled === true || groupDisabled === true
        ? true
        : ownDisabled === undefined && groupDisabled === undefined
          ? undefined
          : false;
    const section = {
      key: `declared:${output.id}`,
      id: output.id,
      title: outputBlockTitle(output),
      ...(source === undefined ? {} : { source }),
      ...(output.chartSpec === undefined ? {} : { chartSpec: output.chartSpec }),
      ...(output.fileOutput ? { files: fileReceipt?.files ?? [] } : {}),
      ...(fileReceipt?.behavior ? { fileBehavior: fileReceipt.behavior } : {}),
      ...(disabled === undefined ? {} : { disabled }),
    };
    if (found === undefined) {
      return {
        ...section,
        outcome: { outcome: 'missing', reason: MISSING_OUTPUT_REASON },
      };
    }
    consumed.add(found.index);
    return { ...section, outcome: matchedOutcome(found) };
  });

  return { outcome: 'outputs', outputs, ...diagnostics };
}
