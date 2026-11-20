import { describe, it, expect } from 'vitest';
import { applyEdit, MAX_VALUE_LENGTH, MAX_PATH_LENGTH } from './apply-edit';

/** Shaped like ai_extract output: wrapped leaves, nested array, metadata. */
const doc = () => ({
  response: {
    vendor_name: { value: 'Acme', confidence_score: 0.4, citation_ids: [1] },
    total: { value: '10.00', confidence_score: 0.9, citation_ids: [2] },
    line_items: [{ amount: { value: '5.00', confidence_score: 0.8, citation_ids: [3] } }],
    plain: 'bare string leaf',
  },
  metadata: { citations: [{ id: 1, page_id: 1 }] },
});

describe('applyEdit', () => {
  it('corrects a wrapped leaf and leaves its evidence alone', () => {
    const d = doc();
    expect(applyEdit(d, 'response.vendor_name', 'Acme Corp')).toBe(true);
    expect(d.response.vendor_name).toEqual({
      value: 'Acme Corp',
      confidence_score: 0.4,
      citation_ids: [1],
    });
  });

  it('corrects a leaf inside an array and a bare primitive leaf', () => {
    const d = doc();
    expect(applyEdit(d, 'response.line_items[0].amount', '6.00')).toBe(true);
    expect(d.response.line_items[0].amount.value).toBe('6.00');
    expect(applyEdit(d, 'response.plain', 'corrected')).toBe(true);
    expect(d.response.plain).toBe('corrected');
  });

  it('refuses prototype-reaching segments and does not pollute Object.prototype', () => {
    const d = doc();
    expect(applyEdit(d, '__proto__.polluted', 'yes')).toBe(false);
    expect(applyEdit(d, 'response.constructor.prototype.polluted', 'yes')).toBe(false);
    expect(applyEdit(d, 'constructor.prototype.polluted', 'yes')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses keys the model never produced', () => {
    const d = doc();
    expect(applyEdit(d, 'response.admin_override', 'true')).toBe(false);
    expect(applyEdit(d, 'response.line_items[9].amount', '1.00')).toBe(false);
    expect(applyEdit(d, 'nope.at.all', 'x')).toBe(false);
    expect('admin_override' in d.response).toBe(false);
  });

  it('refuses replacing a whole object or array with a string', () => {
    const d = doc();
    expect(applyEdit(d, 'response.line_items[0]', 'wiped')).toBe(false);
    expect(applyEdit(d, 'response.line_items', 'wiped')).toBe(false);
    expect(applyEdit(d, 'response', 'wiped')).toBe(false);
    expect(Array.isArray(d.response.line_items)).toBe(true);
  });

  it('refuses forging confidence scores and citations', () => {
    const d = doc();
    expect(applyEdit(d, 'response.vendor_name.confidence_score', '0.99')).toBe(false);
    expect(applyEdit(d, 'response.vendor_name.citation_ids', '[7]')).toBe(false);
    expect(d.response.vendor_name.confidence_score).toBe(0.4);
  });

  it('refuses an oversized value or path', () => {
    const d = doc();
    expect(applyEdit(d, 'response.plain', 'x'.repeat(MAX_VALUE_LENGTH))).toBe(true);
    expect(applyEdit(d, 'response.plain', 'x'.repeat(MAX_VALUE_LENGTH + 1))).toBe(false);
    expect(applyEdit(d, `response.${'a'.repeat(MAX_PATH_LENGTH)}`, 'x')).toBe(false);
  });
});
