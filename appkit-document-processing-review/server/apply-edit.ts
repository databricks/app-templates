import { walk, type Segment } from '../shared/walk';

/** Hard caps on one approval payload. */
export const MAX_EDITS = 500;
export const MAX_VALUE_LENGTH = 10_000;
export const MAX_PATH_LENGTH = 512;

/**
 * True when `key` is an own property of `node`, or an in-range array index.
 * Own properties only, so a key literally named `__proto__` or `constructor`
 * is an ordinary key of the document and nothing reaches `Object.prototype`.
 */
function has(node: unknown, key: Segment): boolean {
  if (Array.isArray(node)) return typeof key === 'number' && key < node.length;
  return typeof node === 'object' && node !== null && Object.prototype.hasOwnProperty.call(node, key);
}

function at(node: unknown, key: Segment): unknown {
  return (node as Record<Segment, unknown>)[key];
}

/** Write as an own data property, so a `__proto__` key cannot hit the setter. */
function put(node: unknown, key: Segment, value: unknown) {
  Object.defineProperty(node, key, { value, writable: true, enumerable: true, configurable: true });
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** "-0012.50" -> "-12.5": the decimal a string commits to, for comparison. */
function canonical(text: string): string {
  const negative = text.startsWith('-');
  const [int, frac = ''] = (negative ? text.slice(1) : text).split('.');
  const f = frac.replace(/0+$/, '');
  const out = int.replace(/^0+(?=\d)/, '') + (f ? `.${f}` : '');
  return negative && out !== '0' ? `-${out}` : out;
}

/**
 * Put the reviewer's text back in the type the model used, so the approved
 * document keeps the input's schema rather than turning every corrected number
 * into a string. A value the model left `null` has no type to preserve and is
 * recorded as text.
 */
function coerce(original: unknown, text: string): { ok: true; value: unknown } | { ok: false } {
  // An object or array has no single text form: the form shows it read-only.
  if (original !== null && typeof original === 'object') return { ok: false };
  if (typeof original === 'number') {
    const trimmed = text.trim();
    if (!NUMERIC.test(trimmed)) return { ok: false };
    const n = Number(trimmed);
    // Refuse rather than round: the stored double has to print back as the
    // same decimal the reviewer typed (this catches underflow to 0 and lost
    // digits), and a whole number has to be a safe integer however it was
    // written. Exponent forms (below 1e-6) are refused too, conservatively.
    const shown = String(n);
    const exact =
      !shown.includes('e') &&
      canonical(shown) === canonical(trimmed) &&
      (!Number.isInteger(n) || Number.isSafeInteger(n));
    // JSON.stringify writes -0 as 0 anyway; be explicit about it.
    return exact ? { ok: true, value: n === 0 ? 0 : n } : { ok: false };
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
 * This is the whole authorisation rule, and it is deliberately a whitelist.
 * The walker roots at `response` (or at `document.elements`), so anything
 * outside it - `metadata.citations[*].bbox`, `metadata.pages[*].image_uri` - is
 * never offered, and inside it `confidence_score`, `citation_ids` and `bbox` are
 * never leaves. The evidence a reviewer is shown cannot be edited because the
 * walker never offered it.
 */
export function editablePaths(root: unknown): Map<string, Segment[] | null> {
  const paths = new Map<string, Segment[] | null>();
  for (const l of walk(root).leaves) {
    // A flat `a.b` key and a nested `a` -> `b` print the same path. Refuse
    // that path rather than guess which one the reviewer meant.
    paths.set(l.path, paths.has(l.path) ? null : l.segments);
  }
  return paths;
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
function applyEdit(root: unknown, path: string, value: string, allowed: Map<string, Segment[] | null>): boolean {
  if (path.length > MAX_PATH_LENGTH || value.length > MAX_VALUE_LENGTH) return false;
  // The walker's own segments, never a re-split of the string: a field name
  // can contain a dot.
  const steps = allowed.get(path);
  if (!steps?.length) return false;

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
      put(target, key, next.value);
      return true;
    }
    // Never replace a whole object or array with a string.
    return false;
  }

  const next = coerce(target, value);
  if (!next.ok) return false;
  put(node, last, next.value);
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
