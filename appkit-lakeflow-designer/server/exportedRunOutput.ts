import { DISPLAY_ROW_LIMIT, summarizeResultPreview } from '../shared/resultPreview';
import { FILE_OUTPUTS_MIME_TYPE, MAX_OUTPUT_FILES, parseFileOutputBehavior, type WrittenFiles } from '../shared/fileOutputs';

const RUNNER_PAYLOAD_VERSION = 2;
const NOTEBOOK_MODEL_ASSIGNMENT = /__DATABRICKS_NOTEBOOK_MODEL = '([^']*)'/;
const ROW_COUNTS_MIME_TYPE = 'application/vnd.databricks.lakeflow-designer.row-counts+json';
// Each cell's display(ctx["<node>.<port>"]) lines name the ports it renders, in source order.
const DISPLAY_CTX_KEY = /display\(ctx\["([^"]+)"\]\)/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function findNotebookModelValue(exportedHtml: unknown): string | undefined {
  if (typeof exportedHtml !== 'string') {
    return undefined;
  }
  const direct = exportedHtml.match(NOTEBOOK_MODEL_ASSIGNMENT);
  if (direct !== null) {
    return direct[1];
  }
  try {
    const nested = Buffer.from(exportedHtml, 'base64').toString().match(NOTEBOOK_MODEL_ASSIGNMENT);
    return nested !== null ? nested[1] : undefined;
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
    const parsed = JSON.parse(decodeURIComponent(Buffer.from(value, 'base64').toString()));
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
    const parsed = JSON.parse(rawType);
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
  return { schema, rows, ...summarizeResultPreview(data.length, entry.overflow) };
}

function resultEntries(results: unknown): unknown[] {
  if (isRecord(results) && (results.type === 'table' || results.type === 'mimeBundle')) return [results];
  return isRecord(results) && Array.isArray(results.data) ? results.data : [];
}

function exactRowCounts(results: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of resultEntries(results)) {
    if (
      !isRecord(entry) ||
      entry.type !== 'mimeBundle' ||
      !isRecord(entry.data) ||
      !Object.prototype.hasOwnProperty.call(entry.data, ROW_COUNTS_MIME_TYPE)
    ) {
      continue;
    }
    const rawPayload = entry.data[ROW_COUNTS_MIME_TYPE];
    let payload = rawPayload;
    if (typeof rawPayload === 'string') {
      try {
        payload = JSON.parse(rawPayload);
      } catch {
        continue;
      }
    }
    if (!isRecord(payload) || typeof payload.node !== 'string' || payload.node === '' || !isRecord(payload.counts)) {
      continue;
    }
    const validEntries: [string, number][] = [];
    for (const [port, count] of Object.entries(payload.counts)) {
      if (port === '' || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        validEntries.length = 0;
        break;
      }
      validEntries.push([port, count]);
    }
    if (validEntries.length === 0) {
      continue;
    }
    for (const [port, count] of validEntries) {
      counts.set(`${payload.node}\0${port}`, count);
    }
  }
  return counts;
}

// Pair only table entries with display(ctx["<node>.<port>"]) calls. The count MIME result is emitted
// by the same cell but is metadata, so it must not consume a table ordinal.
export function exportedModelToRunPayload(exportedHtml: unknown): string | undefined {
  const model = decodeNotebookModel(exportedHtml);
  if (model === undefined || !Array.isArray(model.commands)) {
    return undefined;
  }
  const outputs: Record<string, unknown>[] = [];
  const files: WrittenFiles[] = [];
  for (const command of model.commands) {
    if (!isRecord(command)) {
      continue;
    }
    const keys = displayedCtxKeys(command.command);
    // Receipts are independent of display results. A successful write must stay downloadable
    // even if the preview/count fails or this cell deliberately has no tabular preview.
    for (const entry of resultEntries(command.results)) {
      if (!isRecord(entry) || entry.type !== 'mimeBundle' || !isRecord(entry.data)) continue;
      let receipt = entry.data[FILE_OUTPUTS_MIME_TYPE];
      if (typeof receipt === 'string') {
        try {
          receipt = JSON.parse(receipt);
        } catch {
          continue;
        }
      }
      if (
        isRecord(receipt) && typeof receipt.node === 'string' && receipt.node !== '' &&
        Array.isArray(receipt.files) && receipt.files.length <= MAX_OUTPUT_FILES &&
        receipt.files.every((file) => isRecord(file) && typeof file.path === 'string')
      ) {
        const behavior = parseFileOutputBehavior(receipt.behavior);
        files.push({
          node: receipt.node,
          files: receipt.files.map((file) => ({ path: file.path as string })),
          ...(behavior ? { behavior } : {}),
        });
      }
    }
    const rowCounts = exactRowCounts(command.results);
    const tables = resultEntries(command.results).flatMap((entry) => {
      const table = toDisplayTable(entry);
      return table === undefined ? [] : [table];
    });
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
  return JSON.stringify({ version: RUNNER_PAYLOAD_VERSION, outputs, files });
}
