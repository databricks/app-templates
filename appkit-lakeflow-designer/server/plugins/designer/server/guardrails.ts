import { isMap, parseDocument } from 'yaml';

import type { GuardrailDiagnostic } from '../shared/guardrails';
import { isRecord, nonEmptyString } from '../shared/values';

const ANSI_ESCAPE_SEQUENCE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g');
const GUARDRAILS_MARKER = /\[guardrails\]\s*(?:(WARNING|FAILURE):\s*)?checks\[(\d+)\]\s*(?:\(([^)]*)\))?\s*:\s*(.+)/;

function guardrailOperator(source: unknown): { nodeId: string; operatorName: string } | undefined {
  if (typeof source !== 'string') return undefined;
  // Restrict metadata to the generated leading docstring, never config/code that mentions Guardrails.
  const annotation = source.match(/^\s*"""\r?\n([\s\S]*?)\r?\n"""/);
  if (!annotation) return undefined;
  const doc = parseDocument(annotation[1], { schema: 'failsafe' });
  if (doc.errors.length > 0 || !isMap(doc.contents) || doc.get('template') !== 'guardrails') return undefined;
  const nodeId = nonEmptyString(doc.get('id'));
  if (!nodeId) return undefined;
  return { nodeId, operatorName: nonEmptyString(doc.get('name')) ?? nodeId };
}

function markers(texts: string[], operator?: { nodeId: string; operatorName: string }): GuardrailDiagnostic[] {
  return texts.flatMap((text) =>
    text
      .replace(ANSI_ESCAPE_SEQUENCE, '')
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = line.match(GUARDRAILS_MARKER);
        if (!match || !Number.isSafeInteger(Number(match[2]))) return [];
        return [
          {
            ...operator,
            operatorName: operator?.operatorName ?? 'Guardrails',
            checkIndex: Number(match[2]),
            ...(match[3] ? { checkType: match[3] } : {}),
            severity: match[1] === 'WARNING' ? ('warning' as const) : ('failure' as const),
            message: match[4].trim(),
          },
        ];
      })
  );
}

function summaryText(value: string): string {
  return value
    .replace(/<br\s*\/?>|<\/(?:div|p)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(lt|gt|amp|quot|#39);/g,
      (entity) =>
        ({
          '&lt;': '<',
          '&gt;': '>',
          '&amp;': '&',
          '&quot;': '"',
          '&#39;': "'",
        })[entity] ?? entity
    );
}

export function commandGuardrailDiagnostics(
  command: Record<string, unknown>,
  entries: unknown[]
): GuardrailDiagnostic[] {
  const operator = guardrailOperator(command.command);
  if (!operator) return [];
  const texts = entries.flatMap((entry) =>
    isRecord(entry) && (entry.type === 'ansi' || entry.type === 'text') && typeof entry.data === 'string'
      ? [entry.data]
      : []
  );
  if (typeof command.errorTrace === 'string') texts.push(command.errorTrace);
  if (typeof command.errorSummaryHtml === 'string') texts.push(summaryText(command.errorSummaryHtml));
  return markers(texts, operator);
}

export function mergeGuardrailDiagnostics(
  diagnostics: GuardrailDiagnostic[],
  taskErrorTexts: string[] = []
): GuardrailDiagnostic[] {
  const merged = new Map<string, GuardrailDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.nodeId}\0${diagnostic.checkIndex}`;
    const previous = merged.get(key);
    if (!previous || diagnostic.severity === 'failure') merged.set(key, diagnostic);
  }
  // Jobs can retain the raised exception even when the failed cell's stdout was lost.
  // Without cell metadata, keep an unattributed check rather than guessing an operator.
  for (const diagnostic of markers(taskErrorTexts)) {
    const existing = [...merged.values()].some(
      (entry) =>
        entry.checkIndex === diagnostic.checkIndex &&
        entry.checkType === diagnostic.checkType &&
        entry.message === diagnostic.message &&
        entry.severity === diagnostic.severity
    );
    if (!existing) {
      merged.set(
        `task\0${diagnostic.checkIndex}\0${diagnostic.checkType}\0${diagnostic.severity}\0${diagnostic.message}`,
        diagnostic
      );
    }
  }
  return [...merged.values()];
}
