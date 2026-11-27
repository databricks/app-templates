import { describe, it, expect } from 'vitest';
import { applyEdits, editablePaths, MAX_EDITS, MAX_VALUE_LENGTH, MAX_PATH_LENGTH } from './apply-edit';

/** Shaped like ai_extract output: wrapped leaves, nested array, metadata. */
const doc = () => ({
  response: {
    vendor_name: { value: 'Acme', confidence_score: 0.4, citation_ids: [1] },
    total: { value: 10.5, confidence_score: 0.9, citation_ids: [2] },
    taxable: { value: true, confidence_score: 0.7, citation_ids: [] },
    line_items: [{ amount: { value: '5.00', confidence_score: 0.8, citation_ids: [3] } }],
    plain: 'bare string leaf',
  },
  metadata: {
    citations: [{ id: 1, bbox: [{ coord: [10, 20, 30, 40], page_id: 1 }] }],
    pages: [{ id: 1, image_uri: '/Volumes/c/s/v/page_1.png' }],
  },
});

/** One edit through the real entry point, which derives its own allowlist. */
const edit = (d: unknown, path: string, value: string) => applyEdits(d, { [path]: value }) === null;

describe('applyEdit', () => {
  it('corrects a wrapped leaf and leaves its evidence alone', () => {
    const d = doc();
    expect(edit(d, 'response.vendor_name', 'Acme Corp')).toBe(true);
    expect(d.response.vendor_name).toEqual({
      value: 'Acme Corp',
      confidence_score: 0.4,
      citation_ids: [1],
    });
  });

  it('corrects a leaf inside an array and a bare primitive leaf', () => {
    const d = doc();
    expect(edit(d, 'response.line_items[0].amount', '6.00')).toBe(true);
    expect(d.response.line_items[0].amount.value).toBe('6.00');
    expect(edit(d, 'response.plain', 'corrected')).toBe(true);
    expect(d.response.plain).toBe('corrected');
  });

  /*
    The allowlist is the walker's leaves, so everything the form never offered
    is refused by construction. These three got through an earlier version that
    checked only the last path segment against a list of protected key names.
  */
  it('refuses edits that pass through a protected key', () => {
    const d = doc();
    expect(edit(d, 'response.vendor_name.citation_ids[0]', '7')).toBe(false);
    expect(d.response.vendor_name.citation_ids).toEqual([1]);
    expect(edit(d, 'response.vendor_name.confidence_score', '0.99')).toBe(false);
    expect(d.response.vendor_name.confidence_score).toBe(0.4);
  });

  it('refuses edits to citation geometry and page images', () => {
    const d = doc();
    expect(edit(d, 'metadata.citations[0].bbox[0].coord[0]', '0')).toBe(false);
    expect(edit(d, 'metadata.citations[0].bbox[0].page_id', '2')).toBe(false);
    expect(edit(d, 'metadata.pages[0].image_uri', '/Volumes/c/s/v/other.png')).toBe(false);
    expect(d.metadata.citations[0].bbox[0].coord).toEqual([10, 20, 30, 40]);
    expect(d.metadata.pages[0].image_uri).toBe('/Volumes/c/s/v/page_1.png');
  });

  /*
    The walker offers nothing outside `response` once that key exists, so a
    null response, or ai_classify's array response, cannot expose metadata.
  */
  it('refuses metadata edits when response is null or an array', () => {
    for (const response of [null, ['lodging']]) {
      const d = { ...doc(), response, error_message: null };
      expect(edit(d, 'metadata.citations[0].bbox[0].coord[0]', '0')).toBe(false);
      expect(edit(d, 'metadata.pages[0].image_uri', 'other.png')).toBe(false);
      expect(edit(d, 'metadata.citations[0].id', '9')).toBe(false);
      expect(edit(d, 'error_message', 'x')).toBe(false);
      expect(d.metadata).toEqual(doc().metadata);
    }
  });

  it('edits a field whose name contains a dot, which ai_extract allows', () => {
    const d = { response: { 'unit.price': { value: 70.8 }, 'store.name': { value: 'OLD NAVY' } } };
    expect(edit(d, 'response.unit.price', '9.99')).toBe(true);
    expect(edit(d, 'response.store.name', 'Old Navy')).toBe(true);
    expect(d.response).toEqual({ 'unit.price': { value: 9.99 }, 'store.name': { value: 'Old Navy' } });
  });

  it('refuses a path that is ambiguous between a dotted key and a nested one', () => {
    const d = { response: { 'a.b': { value: 'flat' }, a: { b: { value: 'nested' } } } };
    expect(edit(d, 'response.a.b', 'x')).toBe(false);
    expect(d.response['a.b'].value).toBe('flat');
    expect(d.response.a.b.value).toBe('nested');
  });

  it('edits fields literally named __proto__ or constructor without touching Object.prototype', () => {
    const d = JSON.parse('{"response":{"__proto__":{"value":"a"},"constructor":{"value":"b"}}}') as unknown;
    expect(edit(d, 'response.__proto__', 'A')).toBe(true);
    expect(edit(d, 'response.constructor', 'B')).toBe(true);
    expect(JSON.stringify(d)).toBe('{"response":{"__proto__":{"value":"A"},"constructor":{"value":"B"}}}');
    expect(({} as Record<string, unknown>).value).toBeUndefined();
  });

  it('refuses prototype-reaching segments and does not pollute Object.prototype', () => {
    const d = doc();
    expect(edit(d, '__proto__.polluted', 'yes')).toBe(false);
    expect(edit(d, 'response.constructor.prototype.polluted', 'yes')).toBe(false);
    expect(edit(d, 'constructor.prototype.polluted', 'yes')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses keys the model never produced', () => {
    const d = doc();
    expect(edit(d, 'response.admin_override', 'true')).toBe(false);
    expect(edit(d, 'response.line_items[9].amount', '1.00')).toBe(false);
    expect(edit(d, 'response.line_items.length', '0')).toBe(false);
    expect(edit(d, 'nope.at.all', 'x')).toBe(false);
    expect('admin_override' in d.response).toBe(false);
  });

  it('refuses replacing a whole object or array with a string', () => {
    const d = doc();
    expect(edit(d, 'response.line_items[0]', 'wiped')).toBe(false);
    expect(edit(d, 'response.line_items', 'wiped')).toBe(false);
    expect(edit(d, 'response', 'wiped')).toBe(false);
    expect(Array.isArray(d.response.line_items)).toBe(true);
  });

  /*
    The approved document is promised to carry the input's schema, so a
    corrected number has to come back as a number rather than as the string the
    form sent. Text that is not of the leaf's type is refused rather than
    coerced, which keeps a typo out of the data.
  */
  it('refuses editing a value that is itself an object or an array', () => {
    const d = { response: { o: { value: { a: 1 } }, l: { value: [1, 2] } } };
    expect(edit(d, 'response.o', 'hello')).toBe(false);
    expect(edit(d, 'response.l', 'hello')).toBe(false);
    expect(d.response).toEqual({ o: { value: { a: 1 } }, l: { value: [1, 2] } });
  });

  it('refuses evidence beside unwrapped fields and on elements with no content', () => {
    const d = { response: { addr: { street: { value: '1 Main' }, confidence_score: 0.5, citation_ids: [1] } } };
    expect(edit(d, 'response.addr.confidence_score', '1')).toBe(false);
    expect(edit(d, 'response.addr.citation_ids[0]', '7')).toBe(false);
    expect(d.response.addr).toMatchObject({ confidence_score: 0.5, citation_ids: [1] });
    const e = { document: { elements: [{ id: 0, type: 'figure', bbox: [{ coord: [1, 2, 3, 4], page_id: 0 }] }] } };
    expect(edit(e, 'document.elements[0].bbox[0].coord[0]', '0')).toBe(false);
    expect(edit(e, 'document.elements[0].type', 'text')).toBe(false);
  });

  it('refuses a number that cannot be stored exactly instead of rounding it', () => {
    const d = { response: { n: { value: 1 } } };
    for (const v of ['12345678901234567890', '9007199254740993', '1.0000000000000000001']) {
      expect(edit(d, 'response.n', v)).toBe(false);
    }
    expect(d.response.n.value).toBe(1);
    expect(edit(d, 'response.n', '9007199254740991')).toBe(true);
    expect(edit(d, 'response.n', '109303.32')).toBe(true);
    expect(d.response.n.value).toBe(109303.32);
    // Underflow to zero, and a decimal point hiding an unsafe integer.
    expect(edit(d, 'response.n', `0.${'0'.repeat(323)}1`)).toBe(false);
    expect(edit(d, 'response.n', '100000000000000000000000.0')).toBe(false);
    expect(edit(d, 'response.n', '9007199254740993.0')).toBe(false);
    expect(d.response.n.value).toBe(109303.32);
    // Spellings of the same decimal are fine.
    for (const [typed, stored] of [
      ['-12.50', -12.5],
      ['007', 7],
      ['3.0', 3],
      ['-0', 0],
    ] as const) {
      expect(edit(d, 'response.n', typed)).toBe(true);
      expect(Object.is(d.response.n.value, stored)).toBe(true);
    }
  });

  it('writes a corrected value back in the leaf type the model used', () => {
    const d = doc();
    expect(edit(d, 'response.total', '12.75')).toBe(true);
    expect(d.response.total.value).toBe(12.75);
    expect(edit(d, 'response.taxable', 'false')).toBe(true);
    expect(d.response.taxable.value).toBe(false);
    // A string leaf stays a string, digits or not.
    expect(edit(d, 'response.line_items[0].amount', '6.00')).toBe(true);
    expect(d.response.line_items[0].amount.value).toBe('6.00');
  });

  it('refuses a value that does not parse as the leaf type', () => {
    const d = doc();
    expect(edit(d, 'response.total', 'twelve')).toBe(false);
    expect(edit(d, 'response.total', '')).toBe(false);
    expect(edit(d, 'response.taxable', 'yes')).toBe(false);
    expect(d.response.total.value).toBe(10.5);
    expect(d.response.taxable.value).toBe(true);
  });

  it('refuses an oversized value or path', () => {
    const d = doc();
    expect(edit(d, 'response.plain', 'x'.repeat(MAX_VALUE_LENGTH))).toBe(true);
    expect(edit(d, 'response.plain', 'x'.repeat(MAX_VALUE_LENGTH + 1))).toBe(false);
    expect(edit(d, `response.${'a'.repeat(MAX_PATH_LENGTH)}`, 'x')).toBe(false);
  });
});

describe('editablePaths', () => {
  it('offers exactly the walker leaves, and nothing from metadata', () => {
    expect([...editablePaths(doc()).keys()].sort()).toEqual([
      'response.line_items[0].amount',
      'response.plain',
      'response.taxable',
      'response.total',
      'response.vendor_name',
    ]);
  });

  it('offers indexed leaves for an array under response', () => {
    expect([...editablePaths({ response: ['a', 'b'] }).keys()]).toEqual(['response[0]', 'response[1]']);
  });

  it('offers nothing for a document the form cannot render', () => {
    // A bare array or scalar at the root is not a document the walker can
    // render, so no path is editable and only an unchanged approval is possible.
    expect(editablePaths([1, 2, 3]).size).toBe(0);
    expect(editablePaths('not a document').size).toBe(0);
  });
});

describe('applyEdits', () => {
  it('names the first path it refuses and applies nothing after it', () => {
    const d = doc();
    expect(applyEdits(d, { 'response.plain': 'ok', 'response.admin_override': 'x' })).toBe('response.admin_override');
    expect(applyEdits(d, { 'response.plain': 'ok' })).toBe(null);
    expect(d.response.plain).toBe('ok');
  });

  it('shares one allowlist across a whole payload', () => {
    const d = doc();
    const edits = Object.fromEntries(
      [...editablePaths(d).keys()]
        .filter((p) => p !== 'response.total' && p !== 'response.taxable')
        .map((p) => [p, 'x'])
    );
    expect(applyEdits(d, edits)).toBe(null);
    expect(Object.keys(edits).length).toBeLessThanOrEqual(MAX_EDITS);
  });
});
