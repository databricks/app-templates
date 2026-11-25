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
    expect([...editablePaths(doc())].sort()).toEqual([
      'response.line_items[0].amount',
      'response.plain',
      'response.taxable',
      'response.total',
      'response.vendor_name',
    ]);
  });

  it('offers indexed leaves for an array under response', () => {
    expect([...editablePaths({ response: ['a', 'b'] })]).toEqual(['response[0]', 'response[1]']);
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
      [...editablePaths(d)].filter((p) => p !== 'response.total' && p !== 'response.taxable').map((p) => [p, 'x'])
    );
    expect(applyEdits(d, edits)).toBe(null);
    expect(Object.keys(edits).length).toBeLessThanOrEqual(MAX_EDITS);
  });
});
