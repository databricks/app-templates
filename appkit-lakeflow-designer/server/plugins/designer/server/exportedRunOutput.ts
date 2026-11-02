import {
  FILE_OUTPUTS_MIME_TYPE,
  MAX_OUTPUT_FILES,
  parseFileOutputBehavior,
  type WrittenFiles,
} from '../shared/fileOutputs';
import type { GuardrailDiagnostic } from '../shared/guardrails';
import { isHtmlOutput } from '../shared/htmlOutputs';
import { DISPLAY_ROW_LIMIT, summarizeResultPreview } from '../shared/resultPreview';
import { isRecord } from '../shared/values';
import { commandGuardrailDiagnostics, mergeGuardrailDiagnostics } from './guardrails';

const RUNNER_PAYLOAD_VERSION = 2;
const NOTEBOOK_MODEL_ASSIGNMENT = /__DATABRICKS_NOTEBOOK_MODEL = '([^']*)'/;
const ROW_COUNTS_MIME_TYPE = 'application/vnd.databricks.lakeflow-designer.row-counts+json';
const RUNTIME_NODE_STATE_MIME_TYPE = 'application/vnd.databricks.lakebuilder.runtime-node-state+json';
// Each cell's display(ctx["<node>.<port>"]) lines name the ports it renders, in source order.
const DISPLAY_CTX_KEY = /display\(ctx\["([^"]+)"\]\)/g;

export function findNotebookModelValue(exportedHtml: unknown): string | undefined {
  if (typeof exportedHtml !== 'string') {
    return undefined;
  }
  const direct = exportedHtml.match(NOTEBOOK_MODEL_ASSIGNMENT);
  if (direct !== null) {
    return direct[1];
  }
  try {
    return Buffer.from(exportedHtml, 'base64').toString().match(NOTEBOOK_MODEL_ASSIGNMENT)?.[1];
  } catch {
    return undefined;
  }
}

function decodeNotebookModel(exportedHtml: unknown): Record<string, unknown> | undefined {
  const value = findNotebookModelValue(exportedHtml);
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(Buffer.from(value, 'base64').toString()));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function displayedCtxKeys(source: unknown): string[] {
  if (typeof source !== 'string') {
    return [];
  }
  return Array.from(source.matchAll(DISPLAY_CTX_KEY), (match) => match[1]);
}

// Node names carry no dots, so the last dot separates node and port.
function splitCtxKey(key: string): { node: string; port: string } {
  const dot = key.lastIndexOf('.');
  return dot === -1 ? { node: key, port: '' } : { node: key.slice(0, dot), port: key.slice(dot + 1) };
}

function simpleType(rawType: unknown): string {
  if (typeof rawType !== 'string') {
    return 'string';
  }
  try {
    const parsed: unknown = JSON.parse(rawType);
    return typeof parsed === 'string' ? parsed : rawType;
  } catch {
    return rawType;
  }
}

function toDisplayTable(entry: unknown) {
  if (!isRecord(entry) || entry.type !== 'table' || !Array.isArray(entry.schema) || !Array.isArray(entry.data)) {
    return undefined;
  }
  const schema = entry.schema.filter(isRecord).map((field) => ({
    name: typeof field.name === 'string' ? field.name : '',
    type: simpleType(field.type),
    nullable: typeof field.nullable === 'boolean' ? field.nullable : true,
  }));
  const columnNames = schema.map((field) => field.name);
  const data = entry.data.filter((row) => Array.isArray(row));
  const rows = data
    .slice(0, DISPLAY_ROW_LIMIT)
    .map((row) => Object.fromEntries(columnNames.map((name, index) => [name, row[index] ?? null])));
  // Notebook overflow does not distinguish row and byte limits or carry an exact total.
  // Preserve unknown overflow instead of interpreting absent metadata as a complete result.
  return {
    schema,
    rows,
    ...summarizeResultPreview(data.length, entry.overflow),
  };
}

function resultEntries(results: unknown): unknown[] {
  if (
    isRecord(results) &&
    (results.type === 'table' ||
      results.type === 'mimeBundle' ||
      results.type === 'htmlSandbox' ||
      results.type === 'html' ||
      results.type === 'ansi' ||
      results.type === 'text')
  )
    return [results];
  return isRecord(results) && Array.isArray(results.data) ? results.data : [];
}

// A MIME bundle may carry its payload as an object or a JSON string; unparseable strings are skipped.
function mimePayloads(results: unknown, mimeType: string): unknown[] {
  return resultEntries(results).flatMap((entry) => {
    if (!isRecord(entry) || entry.type !== 'mimeBundle' || !isRecord(entry.data)) return [];
    const payload = entry.data[mimeType];
    if (typeof payload !== 'string') return [payload];
    try {
      const parsed: unknown = JSON.parse(payload);
      return [parsed];
    } catch {
      return [];
    }
  });
}

const isPortCount = (entry: [string, unknown]): entry is [string, number] =>
  entry[0] !== '' && typeof entry[1] === 'number' && Number.isSafeInteger(entry[1]) && entry[1] >= 0;

function exactRowCounts(results: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const payload of mimePayloads(results, ROW_COUNTS_MIME_TYPE)) {
    if (!isRecord(payload) || typeof payload.node !== 'string' || payload.node === '' || !isRecord(payload.counts)) {
      continue;
    }
    // One invalid count discards the node's whole payload.
    const portCounts = Object.entries(payload.counts);
    if (portCounts.length === 0 || !portCounts.every(isPortCount)) {
      continue;
    }
    for (const [port, count] of portCounts) {
      counts.set(`${payload.node}\0${port}`, count);
    }
  }
  return counts;
}

function runtimeNodeStates(results: unknown): Map<string, { disabled: boolean }> {
  const states = new Map<string, { disabled: boolean }>();
  for (const payload of mimePayloads(results, RUNTIME_NODE_STATE_MIME_TYPE)) {
    if (
      isRecord(payload) &&
      typeof payload.nodeId === 'string' &&
      payload.nodeId !== '' &&
      typeof payload.disabled === 'boolean'
    ) {
      states.set(payload.nodeId, { disabled: payload.disabled });
    }
  }
  return states;
}

function writtenFiles(results: unknown): WrittenFiles[] {
  return mimePayloads(results, FILE_OUTPUTS_MIME_TYPE).flatMap((receipt) => {
    if (
      !isRecord(receipt) ||
      typeof receipt.node !== 'string' ||
      receipt.node === '' ||
      !Array.isArray(receipt.files) ||
      receipt.files.length > MAX_OUTPUT_FILES ||
      !receipt.files.every((file): file is { path: string } => isRecord(file) && typeof file.path === 'string')
    ) {
      return [];
    }
    const behavior = parseFileOutputBehavior(receipt.behavior);
    return [
      {
        node: receipt.node,
        files: receipt.files.map((file) => ({ path: file.path })),
        ...(behavior ? { behavior } : {}),
      },
    ];
  });
}

// Only runner-marked HTML cells can become App HTML blocks. Other rich displays stay private.
function htmlOutputs(source: unknown, results: unknown): Record<string, unknown>[] {
  if (typeof source !== 'string') return [];
  const markers = [...source.matchAll(/^# designer-app-html-output: (.+)$/gm)];
  if (markers.length !== 1) return [];
  let node: unknown;
  try {
    node = JSON.parse(markers[0][1]);
  } catch {
    return [];
  }
  if (typeof node !== 'string' || node === '') return [];
  const entries = resultEntries(results).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (entry.type === 'mimeBundle' && isRecord(entry.data) && 'text/html' in entry.data) {
      return [entry.data['text/html']];
    }
    return entry.type === 'htmlSandbox' || entry.type === 'html' ? [entry.data] : [];
  });
  if (entries.length === 0) return [];
  const binding = { kind: 'html', target_node: node };
  if (entries.length !== 1 || !isHtmlOutput(entries[0])) {
    return [
      {
        ...binding,
        status: 'error',
        error: {
          type: 'HtmlOutputError',
          message:
            entries.length !== 1
              ? 'The HTML operator must display exactly one HTML page.'
              : 'The HTML output is invalid or exceeds the 4,194,304-character limit. Reduce the page size or its input data.',
        },
      },
    ];
  }
  return [{ ...binding, status: 'ok', html: entries[0] }];
}

// MIME metadata must not consume a table ordinal when pairing results with display calls.
export function exportedModelToRunPayload(exportedHtml: unknown, taskErrorTexts: string[] = []): string | undefined {
  const model = decodeNotebookModel(exportedHtml);
  if ((model === undefined || !Array.isArray(model.commands)) && taskErrorTexts.length === 0) {
    return undefined;
  }
  const outputs: Record<string, unknown>[] = [];
  const files: WrittenFiles[] = [];
  const diagnostics: GuardrailDiagnostic[] = [];
  const states = new Map<string, { disabled: boolean }>();
  const commands = Array.isArray(model?.commands) ? model.commands : [];
  for (const command of commands) {
    if (!isRecord(command)) {
      continue;
    }
    outputs.push(...htmlOutputs(command.command, command.results));
    diagnostics.push(...commandGuardrailDiagnostics(command, resultEntries(command.results)));
    const keys = displayedCtxKeys(command.command);
    for (const [nodeId, state] of runtimeNodeStates(command.results)) {
      states.set(nodeId, state);
    }
    // Receipts are independent of display results. A successful write must stay downloadable
    // even if the preview/count fails or this cell deliberately has no tabular preview.
    files.push(...writtenFiles(command.results));
    const rowCounts = exactRowCounts(command.results);
    const tables = resultEntries(command.results).flatMap((entry) => toDisplayTable(entry) ?? []);
    tables.forEach((table, index) => {
      const key = keys[index];
      if (key === undefined) {
        return;
      }
      const parts = splitCtxKey(key);
      const totalRowCount = rowCounts.get(`${parts.node}\0${parts.port}`);
      outputs.push({
        status: 'ok',
        target_node: parts.node,
        target_port: parts.port,
        ...table,
        ...(totalRowCount === undefined ? {} : { total_row_count: totalRowCount }),
      });
    });
  }
  return JSON.stringify({
    version: RUNNER_PAYLOAD_VERSION,
    outputs,
    files,
    diagnostics: mergeGuardrailDiagnostics(diagnostics, taskErrorTexts),
    ...(states.size > 0 ? { runtimeNodeStates: Object.fromEntries(states) } : {}),
  });
}
