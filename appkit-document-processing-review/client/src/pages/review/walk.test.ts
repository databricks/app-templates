import { describe, expect, test } from 'vitest';
import { walk, valuesByPath } from './walk';

/**
 * The walker is the only part of this app that has to understand a shape, so
 * these fixtures are the real output shapes of three AI functions, trimmed.
 * If a future AI function arrives with a fourth shape, add it here first.
 */

const aiExtract = {
  response: {
    merchant_name: { value: 'Walgreens', confidence_score: 1.0, citation_ids: [3] },
    tax_amount: { value: null, confidence_score: null, citation_ids: [] },
    line_items: [
      { amount: { value: '4.99', confidence_score: 1.0, citation_ids: [7] } },
      { amount: { value: '3.79', confidence_score: 0.6, citation_ids: [7] } },
    ],
  },
  metadata: {
    citations: [
      { id: 3, bbox: [{ coord: [51, 660, 1457, 1481], page_id: 0 }] },
      { id: 7, bbox: [{ coord: [10, 20, 30, 40], page_id: 1 }] },
    ],
    pages: [
      { id: 0, image_uri: '/Volumes/c/s/v/page0.jpg' },
      { id: 1, image_uri: '/Volumes/c/s/v/page1.jpg' },
    ],
  },
};

const aiParseDocument = {
  document: {
    elements: [
      { id: 0, type: 'text', content: 'OLD NAVY - 03788', confidence: 0.9, bbox: [{ coord: [48, 109, 583, 402], page_id: 0 }] },
      { id: 1, type: 'table', content: 'DATE | CHARGES', confidence: 0.81, bbox: [{ coord: [1, 2, 3, 4], page_id: 0 }] },
    ],
    pages: [{ id: 0, image_uri: '/Volumes/c/s/v/parse0.jpg' }],
  },
  metadata: { version: '2.0' },
};

const aiClassify = {
  response: {
    expense_category: { value: 'lodging' },
    reimbursable: { value: 'reimbursable' },
  },
  metadata: { citations: [], pages: [{ id: 0, image_uri: '/Volumes/c/s/v/classify0.jpg' }] },
};

describe('ai_extract output', () => {
  const { leaves, citations, pageImages } = walk(aiExtract);

  test('discovers every scalar and every array leaf', () => {
    expect(leaves.map((l) => l.path)).toEqual([
      'response.merchant_name',
      'response.tax_amount',
      'response.line_items[0].amount',
      'response.line_items[1].amount',
    ]);
  });

  test('array leaves carry a group and an index, scalars do not', () => {
    const amounts = leaves.filter((l) => l.groupName !== null);
    expect(amounts.map((l) => [l.groupName, l.itemIndex])).toEqual([
      ['response.line_items', 0],
      ['response.line_items', 1],
    ]);
    expect(leaves[0].groupName).toBeNull();
  });

  test('leaves of one array share an index-free type key', () => {
    expect(leaves[2].typeKey).toBe('response.line_items.amount');
    expect(leaves[3].typeKey).toBe(leaves[2].typeKey);
  });

  test('unwraps value, confidence and citations', () => {
    expect(leaves[0]).toMatchObject({ value: 'Walgreens', confidence: 1.0, citationIds: [3] });
  });

  test('a value the model never found is null, not missing', () => {
    expect(leaves[1].value).toBeNull();
    expect(leaves[1].confidence).toBeNull();
  });

  test('indexes citations and page images for the UI to resolve', () => {
    expect(citations.get(3)).toEqual({ coord: [51, 660, 1457, 1481], pageId: 0 });
    expect(pageImages.get(1)).toBe('page1.jpg');
  });

  test('numeric-looking strings get the number widget', () => {
    expect(leaves[2].kind).toBe('number');
    expect(leaves[0].kind).toBe('text');
  });
});

describe('ai_parse_document output', () => {
  const { leaves, pageImages } = walk(aiParseDocument);

  test('each element is one leaf, keyed by its content path', () => {
    expect(leaves.map((l) => l.path)).toEqual([
      'document.elements[0].content',
      'document.elements[1].content',
    ]);
  });

  test('element type lands in the type key, so labels differ per type', () => {
    expect(leaves.map((l) => l.typeKey)).toEqual([
      'document.elements.text',
      'document.elements.table',
    ]);
  });

  test('evidence is read from the leaf itself, not from a citation', () => {
    expect(leaves[0]).toMatchObject({ coord: [48, 109, 583, 402], pageId: 0, citationIds: [] });
  });

  test('confidence comes from the element field of that name', () => {
    expect(leaves.map((l) => l.confidence)).toEqual([0.9, 0.81]);
  });

  test('pages are found under document, not metadata', () => {
    expect(pageImages.get(0)).toBe('parse0.jpg');
  });
});

describe('ai_classify output', () => {
  const { leaves, citations, pageImages } = walk(aiClassify);

  test('wrapped scalars are discovered with no confidence and no citation', () => {
    expect(leaves.map((l) => [l.path, l.value, l.confidence, l.citationIds])).toEqual([
      ['response.expense_category', 'lodging', null, []],
      ['response.reimbursable', 'reimbursable', null, []],
    ]);
  });

  test('a page with no citations is still available, so the reviewer can read it', () => {
    expect(citations.size).toBe(0);
    expect(pageImages.get(0)).toBe('classify0.jpg');
  });
});

describe('shapes with no recognised envelope', () => {
  test('bare scalars are their own values', () => {
    const { leaves } = walk({ category: 'apparel', score: 0.5 });
    expect(leaves.map((l) => [l.path, l.value, l.kind])).toEqual([
      ['category', 'apparel', 'text'],
      ['score', '0.5', 'number'],
    ]);
  });

  test('an empty object is reported as one read-only leaf rather than vanishing', () => {
    const { leaves } = walk({ response: { odd: {} } });
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toMatchObject({ path: 'response.odd', kind: 'json' });
  });

  test('an empty array contributes no leaves', () => {
    const { leaves } = walk({ response: { line_items: [] } });
    expect(leaves).toHaveLength(0);
  });

  test('non-objects are handled without throwing', () => {
    expect(walk(null).leaves).toEqual([]);
    expect(walk('a string').leaves).toEqual([]);
  });
});

describe('valuesByPath, used to overlay an approved document', () => {
  test('keys match the paths the walker emits, so approved values line up', () => {
    const approved = structuredClone(aiExtract);
    approved.response.merchant_name.value = 'Walgreens #1234';
    const values = valuesByPath(approved);
    expect(values.get('response.merchant_name')).toBe('Walgreens #1234');
    expect(values.get('response.line_items[1].amount')).toBe('3.79');
  });
});
