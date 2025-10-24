// Helpers for parsing/serializing tool-call and tool-result tags

export type ParsedToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ParsedToolResult = {
  id: string;
  content: unknown;
};

const TAGS = {
  LEGACY_CALL_OPEN: '<uc_function_call>',
  LEGACY_CALL_CLOSE: '</uc_function_call>',
  LEGACY_RESULT_OPEN: '<uc_function_result>',
  LEGACY_RESULT_CLOSE: '</uc_function_result>',
  CALL_OPEN: '<tool_call>',
  CALL_CLOSE: '</tool_call>',
  RESULT_OPEN: '<tool_call_result>',
  RESULT_CLOSE: '</tool_call_result>',
} as const;

export const tagSplitRegex = new RegExp(
  `(${escapeRegex(TAGS.LEGACY_CALL_OPEN)}.*?${escapeRegex(TAGS.LEGACY_CALL_CLOSE)}|` +
    `${escapeRegex(TAGS.LEGACY_RESULT_OPEN)}.*?${escapeRegex(TAGS.LEGACY_RESULT_CLOSE)}|` +
    `${escapeRegex(TAGS.CALL_OPEN)}.*?${escapeRegex(TAGS.CALL_CLOSE)}|` +
    `${escapeRegex(TAGS.RESULT_OPEN)}.*?${escapeRegex(TAGS.RESULT_CLOSE)})`,
  'g',
);

export function parseTaggedToolCall(text: string): ParsedToolCall | null {
  const inner =
    stripEnclosingTag(text, TAGS.LEGACY_CALL_OPEN, TAGS.LEGACY_CALL_CLOSE) ??
    stripEnclosingTag(text, TAGS.CALL_OPEN, TAGS.CALL_CLOSE);
  if (inner == null) return null;
  try {
    const parsed = JSON.parse(inner);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'id' in parsed &&
      'name' in parsed
    ) {
      return {
        id: String((parsed as any).id),
        name: String((parsed as any).name),
        arguments: (parsed as any).arguments,
      };
    }
  } catch {}
  return null;
}

export function parseTaggedToolResult(text: string): ParsedToolResult | null {
  const inner =
    stripEnclosingTag(
      text,
      TAGS.LEGACY_RESULT_OPEN,
      TAGS.LEGACY_RESULT_CLOSE,
    ) ?? stripEnclosingTag(text, TAGS.RESULT_OPEN, TAGS.RESULT_CLOSE);
  if (inner == null) return null;
  try {
    const parsed = JSON.parse(inner);
    if (parsed && typeof parsed === 'object' && 'id' in parsed) {
      return {
        id: String((parsed as any).id),
        content: (parsed as any).content,
      };
    }
  } catch {}
  return null;
}

export function serializeToolCall(value: ParsedToolCall): string {
  const payload = JSON.stringify({
    id: value.id,
    name: value.name,
    arguments: value.arguments,
  });
  return `${TAGS.CALL_OPEN}${payload}${TAGS.CALL_CLOSE}`;
}

export function serializeToolResult(value: ParsedToolResult): string {
  const payload = JSON.stringify({ id: value.id, content: value.content });
  return `${TAGS.RESULT_OPEN}${payload}${TAGS.RESULT_CLOSE}`;
}

function stripEnclosingTag(
  text: string,
  open: string,
  close: string,
): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
    return trimmed.slice(open.length, trimmed.length - close.length);
  }
  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
