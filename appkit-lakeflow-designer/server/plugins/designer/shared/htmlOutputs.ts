export const MAX_HTML_OUTPUT_CHARS = 4 * 1024 * 1024;

export function isHtmlOutput(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_HTML_OUTPUT_CHARS;
}
