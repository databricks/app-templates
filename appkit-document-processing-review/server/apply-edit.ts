import { walk } from '../shared/walk';

/** Hard caps on one approval payload. */
export const MAX_EDITS = 500;
export const MAX_VALUE_LENGTH = 10_000;
export const MAX_PATH_LENGTH = 512;

/**
 * Segments that would reach `Object.prototype` instead of the document. A
 * VARIANT really can carry a `__proto__` key - `JSON.parse` makes it an own
 * property - so the walker can legitimately produce such a path, and a plain
 * assignment there would still write the prototype. Refuse them outright.
 */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** True when `key` is an own property of `node`, or an in-range array index. */
function has(node: unknown, key: string): boolean {
  if (Array.isArray(node)) return /^\d+$/.test(key) && Number(key) < node.length;
  return typeof node === 'object' && node !== null && Object.prototype.hasOwnProperty.call(node, key);
}

function at(node: unknown, key: string): unknown {
  return Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key];
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Put the reviewer's text back in the type the model used, so the approved
 * document keeps the input's schema rather than turning every corrected number
 * into a string. A value the model left `null` has no type to preserve and is
 * recorded as text.
 */
function coerce(original: unknown, text: string): { ok: true; value: unknown } | { ok: false } {
  if (typeof original === 'number') {
    const trimmed = text.trim();
    if (!NUMERIC.test(trimmed)) return { ok: false };
    const n = Number(trimmed);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  if (typeof original === 'boolean') {
    const t = text.trim().toLowerCase();
    if (t === 'true') return { ok: true, value: true };
    if (t === 'false') return { ok: true, value: false };
    return { ok: false };
  }
  return { ok: true, value: text };
}

/**
 * The paths a reviewer is allowed to edit: exactly the leaves the walker
 * produces for the server's own copy of the document, which is also exactly
 * what the form rendered.
 *
 * This is the whole authorisation rule, and it is deliberately a whitelist
 * rather than a list of keys to protect. The walker roots at `response` (or at
 * `document.elements`), so anything outside it - `metadata.citations[*].bbox`,
 * `metadata.pages[*].image_uri` - is structurally unreachable, and inside it a
 * leaf's own `confidence_score` and `citation_ids` are metadata of the leaf
 * rather than leaves themselves. No key name is special-cased: the evidence a
 * reviewer is shown cannot be edited because the walker never offered it.
 */
export function editablePaths(root: unknown): Set<string> {
  return new Set(walk(root).leaves.map((l) => l.path));
}

/**
 * Apply one reviewer edit to a copy of the model's response, at a path the
 * walker produced ("response.line_items[0].amount"). `allowed` comes from
 * `editablePaths` on the server's own copy of the document.
 *
 * Returns `false` instead of writing when the path is not an editable leaf, or
 * when the text does not parse as the leaf's own type. An object leaf keeps its
 * wrapper and only the `value`/`content` inside it changes, which is what keeps
 * `approved_response` in the same schema as `response`.
 */
function applyEdit(root: unknown, path: string, value: string, allowed: Set<string>): boolean {
  if (path.length > MAX_PATH_LENGTH || value.length > MAX_VALUE_LENGTH) return false;
  if (!allowed.has(path)) return false;

  const steps = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (!steps.length) return false;
  if (steps.some((s) => UNSAFE_SEGMENTS.has(s))) return false;

  const last = steps[steps.length - 1];

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
    for (const key of ['value', 'content'] as const) {
      if (!has(target, key)) continue;
      const next = coerce((target as Record<string, unknown>)[key], value);
      if (!next.ok) return false;
      (target as Record<string, unknown>)[key] = next.value;
      return true;
    }
    // Never replace a whole object or array with a string.
    return false;
  }

  const next = coerce(target, value);
  if (!next.ok) return false;
  if (Array.isArray(node)) node[Number(last)] = next.value;
  else (node as Record<string, unknown>)[last] = next.value;
  return true;
}

/**
 * Overlay a whole approval payload onto `root`, in place. Returns the first
 * path that is not an editable leaf, or `null` when every edit applied.
 */
export function applyEdits(root: unknown, edits: Record<string, string>): string | null {
  const allowed = editablePaths(root);
  for (const [path, value] of Object.entries(edits)) {
    if (!applyEdit(root, path, value, allowed)) return path;
  }
  return null;
}
