/**
 * Turns any AI-function output into a flat list of reviewable values.
 *
 * Nothing here knows a field name. Three shapes are recognised, in order:
 *
 *  - `{response: ...}`          ai_extract (an object) or ai_classify 2.x (an
 *                               array of labels). Leaves are usually
 *                               `{value, confidence_score, citation_ids}`. When
 *                               the key exists it is the only root: the rest of
 *                               the document is metadata, not values.
 *  - `{document: {elements:[]}}` ai_parse_document. Each element is a leaf whose
 *                               value is `content`, with its own `confidence`
 *                               and an inline `bbox`.
 *  - anything else              walked as-is; bare scalars are their own values.
 *
 * Confidence and evidence are optional everywhere: a function that provides
 * neither still produces an editable, approvable form.
 */

export type Segment = string | number;

export type Leaf = {
  /** Full path from the document root: "response.line_items[0].amount". */
  path: string;
  /**
   * The same location as keys and indices. The server writes through these
   * rather than re-splitting `path`, because a field name may itself contain
   * a dot (ai_extract allows `unit.price`).
   */
  segments: Segment[];
  /** Path with array indices removed, so leaves of one array share a label. */
  typeKey: string;
  /** Set for leaves inside an array. */
  groupName: string | null;
  itemIndex: number | null;
  value: string | null;
  confidence: number | null;
  citationIds: number[];
  /** Evidence carried on the leaf itself (ai_parse_document). */
  coord: number[] | null;
  pageId: number | null;
  /** "number" | "text" | "json" */
  kind: 'number' | 'text' | 'json';
};

export type Evidence = { coord: number[] | null; pageId: number | null };

export type WalkResult = {
  leaves: Leaf[];
  /** citation id -> bbox, from metadata.citations (ai_extract). */
  citations: Map<number, Evidence>;
  /** page id -> full image path, from metadata.pages or document.pages. */
  pageImages: Map<number, string>;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const NUMERIC = /^-?\d+(\.\d+)?$/;

const kindOf = (v: unknown): Leaf['kind'] => {
  // An object or array value has no single text form to edit: read-only.
  if (typeof v === 'object' && v !== null) return 'json';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string' && NUMERIC.test(v.trim())) return 'number';
  return 'text';
};

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v, null, 1);
  // Objects are handled above; render the remaining primitives without
  // relying on Object's default stringification.
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  return JSON.stringify(v, null, 1) ?? null;
};

const stripIndices = (path: string) => path.replace(/\[\d+\]/g, '');

/** A leaf as ai_extract writes it. */
const isWrapped = (v: unknown): boolean => isObj(v) && 'value' in v;

/** A leaf as ai_parse_document writes it: evidence inline, value in `content`. */
const isElement = (v: unknown): boolean => isObj(v) && Array.isArray(v.bbox);

/**
 * Evidence that sits beside values. Never a leaf, whatever the shape around
 * it, unless the key holds a wrapped value of its own (an extracted field that
 * happens to share the name).
 */
const EVIDENCE_KEYS = new Set(['confidence_score', 'citation_ids', 'bbox']);

function bboxOf(node: Record<string, unknown>): Evidence {
  const bbox = node.bbox;
  if (Array.isArray(bbox) && isObj(bbox[0])) {
    const first = bbox[0];
    const coord = Array.isArray(first.coord) ? (first.coord as unknown[]).map(Number) : null;
    const pageId = typeof first.page_id === 'number' ? first.page_id : null;
    return { coord: coord && coord.length === 4 ? coord : null, pageId };
  }
  return { coord: null, pageId: null };
}

function emit(node: unknown, path: string, segments: Segment[], group: string | null, index: number | null): Leaf[] {
  // Wrapped leaf: value plus whatever metadata the function provided.
  if (isWrapped(node)) {
    const o = node as Record<string, unknown>;
    const raw = o.value;
    return [
      {
        path,
        segments,
        typeKey: stripIndices(path),
        groupName: group,
        itemIndex: index,
        value: asText(raw),
        confidence: typeof o.confidence_score === 'number' ? o.confidence_score : null,
        citationIds: Array.isArray(o.citation_ids) ? (o.citation_ids as unknown[]).map(Number) : [],
        ...bboxOf(o),
        kind: raw === null || raw === undefined ? 'number' : kindOf(raw),
      },
    ];
  }

  // ai_parse_document element: the content is the value, evidence is inline.
  if (isElement(node)) {
    const o = node as Record<string, unknown>;
    // An element with no text (a bare figure) has nothing to correct.
    if (!('content' in o)) return [];
    const type = typeof o.type === 'string' ? o.type : 'element';
    return [
      {
        path: `${path}.content`,
        segments: [...segments, 'content'],
        typeKey: `${stripIndices(path)}.${type}`,
        groupName: group,
        itemIndex: index,
        value: asText(o.content),
        confidence: typeof o.confidence === 'number' ? o.confidence : null,
        citationIds: [],
        ...bboxOf(o),
        kind: 'text',
      },
    ];
  }

  if (Array.isArray(node)) {
    return node.flatMap((item, i) => emit(item, `${path}[${i}]`, [...segments, i], stripIndices(path), i));
  }

  if (isObj(node)) {
    const keys = Object.keys(node).filter((k) => !(EVIDENCE_KEYS.has(k) && !isWrapped(node[k])));
    const children = keys.flatMap((k) => emit(node[k], path ? `${path}.${k}` : k, [...segments, k], group, index));
    if (children.length > 0) return children;
    /*
      Nothing reviewable inside. Two different cases, and conflating them turns
      a document with an empty array into one unreadable JSON blob:
        - the object has keys that simply yielded no leaves (empty arrays, say),
          so there is genuinely nothing to review here;
        - the object is opaque (no keys at all), which is worth showing
          read-only so the reviewer can see that something is there.
    */
    if (Object.keys(node).length > 0) return [];
    return [
      {
        path,
        segments,
        typeKey: stripIndices(path),
        groupName: group,
        itemIndex: index,
        value: asText(node),
        confidence: null,
        citationIds: [],
        coord: null,
        pageId: null,
        kind: 'json',
      },
    ];
  }

  // Bare scalar: it is its own value.
  return [
    {
      path,
      segments,
      typeKey: stripIndices(path),
      groupName: group,
      itemIndex: index,
      value: asText(node),
      confidence: null,
      citationIds: [],
      coord: null,
      pageId: null,
      kind: kindOf(node),
    },
  ];
}

export function walk(doc: unknown): WalkResult {
  const citations = new Map<number, Evidence>();
  const pageImages = new Map<number, string>();

  if (!isObj(doc)) return { leaves: [], citations, pageImages };

  // Evidence indexes, wherever this function happens to keep them.
  const metadata = isObj(doc.metadata) ? doc.metadata : {};
  const document = isObj(doc.document) ? doc.document : {};
  for (const c of (Array.isArray(metadata.citations) ? metadata.citations : []) as unknown[]) {
    if (!isObj(c) || typeof c.id !== 'number') continue;
    citations.set(c.id, bboxOf(c));
  }
  for (const source of [metadata.pages, document.pages]) {
    for (const p of (Array.isArray(source) ? source : []) as unknown[]) {
      if (!isObj(p) || typeof p.id !== 'number') continue;
      // The full path, not the file name: imageOutputPath can be any folder of
      // the volume, and a bare name resolves against the volume root.
      if (typeof p.image_uri === 'string' && p.image_uri) pageImages.set(p.id, p.image_uri);
    }
  }

  // Field root, in precedence order. A `response` key is the root whatever it
  // holds - ai_classify returns an array there - and a null one has nothing to
  // review. Walking the whole document instead would offer `metadata` and
  // `error_message` as values.
  let leaves: Leaf[] = [];
  if ('response' in doc) {
    leaves = doc.response === null ? [] : emit(doc.response, 'response', ['response'], null, null);
  } else if (Array.isArray(document.elements)) {
    leaves = emit(document.elements, 'document.elements', ['document', 'elements'], 'elements', null);
  } else {
    leaves = emit(doc, '', [], null, null);
  }

  return { leaves, citations, pageImages };
}

/** Flat path -> value map, used to compare an approved document with the model's. */
export function valuesByPath(doc: unknown): Map<string, string | null> {
  return new Map(walk(doc).leaves.map((l) => [l.path, l.value]));
}
