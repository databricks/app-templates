/** Hard caps on one approval payload. */
export const MAX_EDITS = 500;
export const MAX_VALUE_LENGTH = 10_000;
export const MAX_PATH_LENGTH = 512;

/** Segments that would reach `Object.prototype` instead of the document. */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Model metadata the form never makes editable. The README promises confidence
 * scores and citations ride along untouched, so the server enforces that rather
 * than trusting the client to leave them alone.
 */
const READ_ONLY_KEYS = new Set(['confidence_score', 'citation_ids', 'confidence']);

/**
 * True when `key` is an own property of `node`, or an in-range array index.
 * `hasOwnProperty.call` rather than `Object.hasOwn` only because the server
 * targets ES2020, as it does in every AppKit template; the two are equivalent
 * here, and both ignore inherited keys, which is the point.
 */
function has(node: unknown, key: string): boolean {
  if (Array.isArray(node)) return /^\d+$/.test(key) && Number(key) < node.length;
  return typeof node === 'object' && node !== null && Object.prototype.hasOwnProperty.call(node, key);
}

function at(node: unknown, key: string): unknown {
  return Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key];
}

/**
 * Apply one reviewer edit to a copy of the model's response, at a path the
 * walker produced ("response.line_items[0].amount").
 *
 * Returns `false` instead of writing when the path is not an editable leaf the
 * model itself wrote. The client is the only source of these paths, so each one
 * is re-derived against the server's own copy of the document: every step has to
 * be an existing own property, the leaf has to already exist, and an object leaf
 * may only have its wrapper's `value`/`content` replaced. That is what stops a
 * caller inventing keys, overwriting a whole object with a string, forging a
 * confidence score, or reaching the prototype chain.
 *
 * The surrounding structure is otherwise untouched, which is what keeps
 * `approved_response` in the same schema as `response`.
 */
export function applyEdit(root: unknown, path: string, value: string): boolean {
  if (path.length > MAX_PATH_LENGTH || value.length > MAX_VALUE_LENGTH) return false;

  const steps = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (!steps.length) return false;
  if (steps.some((s) => UNSAFE_SEGMENTS.has(s))) return false;

  const last = steps[steps.length - 1];
  if (READ_ONLY_KEYS.has(last)) return false;

  let node: unknown = root;
  for (let i = 0; i < steps.length - 1; i++) {
    if (!has(node, steps[i])) return false;
    const next = at(node, steps[i]);
    if (next === null || typeof next !== 'object') return false;
    node = next;
  }

  // The leaf has to be one the model already produced: no new keys.
  if (!has(node, last)) return false;

  const target = at(node, last);
  if (target !== null && typeof target === 'object') {
    // A wrapped leaf keeps its wrapper: only the value inside it changes.
    if (has(target, 'value')) {
      (target as Record<string, unknown>).value = value;
      return true;
    }
    if (has(target, 'content')) {
      (target as Record<string, unknown>).content = value;
      return true;
    }
    // Never replace a whole object or array with a string.
    return false;
  }

  if (Array.isArray(node)) node[Number(last)] = value;
  else (node as Record<string, unknown>)[last] = value;
  return true;
}
