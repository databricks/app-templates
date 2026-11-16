/**
 * Turns any AI-function output into a flat list of reviewable values.
 *
 * Nothing here knows a field name. Three shapes are recognised, in order:
 *
 *  - `{response: {...}}`        ai_extract, or any scalar function wrapped into
 *                               a struct (ai_classify). Leaves are usually
 *                               `{value, confidence_score, citation_ids}`.
 *  - `{document: {elements:[]}}` ai_parse_document. Each element is a leaf whose
 *                               value is `content`, with its own `confidence`
 *                               and an inline `bbox`.
 *  - anything else              walked as-is; bare scalars are their own values.
 *
 * Confidence and evidence are optional everywhere: a function that provides
 * neither still produces an editable, approvable form.
 */

export type Leaf = {
  /** Full path from the document root: "response.line_items[0].amount". */
  path: string;
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
  /** page id -> image file name, from metadata.pages or document.pages. */
  pageImages: Map<number, string>;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const NUMERIC = /^-?\d+(\.\d+)?$/;

const kindOf = (v: unknown): 'number' | 'text' => {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string' && NUMERIC.test(v.trim())) return 'number';
  return 'text';
};

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v, null, 1);
  // Narrowed: objects are handled above, so this is a primitive.
  return String(v as string | number | boolean);
};

const stripIndices = (path: string) => path.replace(/\[\d+\]/g, '');

/** A leaf as ai_extract writes it. */
const isWrapped = (v: unknown): boolean => isObj(v) && 'value' in v;

/** A leaf as ai_parse_document writes it. */
const isElement = (v: unknown): boolean => isObj(v) && 'content' in v && 'bbox' in v;

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

function emit(node: unknown, path: string, group: string | null, index: number | null): Leaf[] {
  // Wrapped leaf: value plus whatever metadata the function provided.
  if (isWrapped(node)) {
    const o = node as Record<string, unknown>;
    const raw = o.value;
    return [
      {
        path,
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
    const type = typeof o.type === 'string' ? o.type : 'element';
    return [
      {
        path: `${path}.content`,
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
    return node.flatMap((item, i) => emit(item, `${path}[${i}]`, stripIndices(path), i));
  }

  if (isObj(node)) {
    const keys = Object.keys(node);
    const children = keys.flatMap((k) => emit(node[k], path ? `${path}.${k}` : k, group, index));
    if (children.length > 0) return children;
    /*
      Nothing reviewable inside. Two different cases, and conflating them turns
      a document with an empty array into one unreadable JSON blob:
        - the object has keys that simply yielded no leaves (empty arrays, say),
          so there is genuinely nothing to review here;
        - the object is opaque (no keys at all), which is worth showing
          read-only so the reviewer can see that something is there.
    */
    if (keys.length > 0) return [];
    return [
      {
        path,
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

const basename = (uri: unknown): string | null =>
  typeof uri === 'string' ? (uri.split('/').pop() ?? null) : null;

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
      const file = basename(p.image_uri);
      if (file) pageImages.set(p.id, file);
    }
  }

  // Field root, in precedence order.
  let leaves: Leaf[] = [];
  if (isObj(doc.response)) {
    leaves = emit(doc.response, 'response', null, null);
  } else if (Array.isArray(document.elements)) {
    leaves = emit(document.elements, 'document.elements', 'elements', null);
  } else {
    leaves = emit(doc, '', null, null);
  }

  return { leaves, citations, pageImages };
}

/** Flat path -> value map, used to compare an approved document with the model's. */
export function valuesByPath(doc: unknown): Map<string, string | null> {
  return new Map(walk(doc).leaves.map((l) => [l.path, l.value]));
}
