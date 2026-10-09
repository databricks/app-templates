import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
} from '@tanstack/react-table';
import { build } from 'tsdown';

let createResultColumns;
let createResultFilter;
let outputDirectory;

before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.table-tests-', import.meta.url)));
  await build({
    entry: ['client/src/resultTable.ts'],
    config: false,
    tsconfig: 'tsconfig.client.json',
    outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  ({ createResultColumns, createResultFilter } = await import(pathToFileURL(join(outputDirectory, 'resultTable.mjs')).href));
});

after(async () => {
  if (outputDirectory !== undefined) await rm(outputDirectory, { recursive: true });
});

function tableFor(schema, rows, state = {}) {
  return createTable({
    data: rows,
    columns: createResultColumns(schema),
    state: {
      sorting: [],
      columnFilters: [],
      globalFilter: '',
      columnVisibility: {},
      columnPinning: { left: [], right: [] },
      ...state,
    },
    onStateChange() {},
    renderFallbackValue: null,
    globalFilterFn: createResultFilter(schema),
    getColumnCanGlobalFilter: () => true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
}

const field = (name, type) => ({ name, type, nullable: true });

for (const [type, values, expected] of [
  ['bigint', ['10', '9007199254740993', '-2', '2', '9007199254740992', null], [null, '-2', '2', '10', '9007199254740992', '9007199254740993']],
  ['decimal(38,18)', ['1.000000000000000002', '-10.2', '-2.5', '1.000000000000000001', '01.00', '-0.00'], ['-10.2', '-2.5', '-0.00', '01.00', '1.000000000000000001', '1.000000000000000002']],
  ['double', ['1e3', '-2.5', '2', '10'], ['-2.5', '2', '10', '1e3']],
  ['timestamp', ['2026-01-01T00:30:00+02:00', '2025-12-31T23:00:00Z'], ['2026-01-01T00:30:00+02:00', '2025-12-31T23:00:00Z']],
  ['date', ['2026-10-01', '2025-01-02', '2026-02-01'], ['2025-01-02', '2026-02-01', '2026-10-01']],
  ['string', ['20', '10', '2'], ['10', '2', '20']],
  ['boolean', [true, false, null], [null, false, true]],
]) {
  test(`sorts ${type} values by their schema type without changing cell values`, () => {
    const schema = [field('value', type)];
    const rows = values.map((value) => ({ value }));
    const original = structuredClone(rows);
    for (const desc of [false, true]) {
      const table = tableFor(schema, rows, { sorting: [{ id: '0', desc }] });
      assert.deepEqual(table.getRowModel().rows.map((row) => row.original.value), desc ? [...expected].reverse() : expected);
    }
    assert.deepEqual(rows, original);
  });
}

test('searches formatted strings, numbers, nulls and nested values across every column', () => {
  const schema = [field('name', 'string'), field('count', 'bigint'), field('details', 'struct<x:string>')];
  const rows = [
    { name: 'Alpha', count: '9007199254740993', details: { note: 'North' } },
    { name: 'Beta', count: null, details: { note: 'South' } },
  ];
  for (const [search, expected] of [
    [' ALPHA ', 'Alpha'], ['9007199254740993', 'Alpha'], ['north', 'Alpha'], ['NULL', 'Beta'], ['south', 'Beta'],
  ]) {
    const table = tableFor(schema, rows, { globalFilter: search });
    assert.deepEqual(table.getRowModel().rows.map((row) => row.original.name), [expected]);
  }
  assert.equal(tableFor(schema, rows, { globalFilter: 'not present' }).getRowModel().rows.length, 0);
});

test('filters and sorts all matching rows and preserves original row numbers', () => {
  const schema = [field('value', 'int'), field('group', 'string')];
  const rows = Array.from({ length: 70 }, (_, value) => ({ value, group: value % 2 === 0 ? 'even' : 'odd' }));
  const table = tableFor(schema, rows, {
    globalFilter: 'even',
    sorting: [{ id: '0', desc: true }],
  });
  assert.equal(table.getFilteredRowModel().rows.length, 35);
  const expectedValues = Array.from({ length: 35 }, (_, index) => 68 - index * 2);
  assert.deepEqual(table.getRowModel().rows.map((row) => row.original.value), expectedValues);
  assert.deepEqual(table.getRowModel().rows.map((row) => row.index + 1), expectedValues.map((value) => value + 1));
});

test('column visibility and SQL aliases do not change or reinterpret the result data', () => {
  const schema = [field('sales.total', 'int'), field('__proto__', 'string'), field('constructor', 'string')];
  const rows = [JSON.parse('{"sales.total":42,"__proto__":"alias","constructor":"kept"}')];
  const table = tableFor(schema, rows, { columnVisibility: { '1': false } });
  assert.deepEqual(table.getVisibleLeafColumns().map((column) => column.columnDef.header), ['sales.total', 'constructor']);
  assert.deepEqual(table.getRowModel().rows[0].getVisibleCells().map((cell) => cell.getValue()), [42, 'kept']);
  assert.equal(table.getRowModel().rows[0].getValue('1'), 'alias');
  assert.deepEqual(Object.keys(rows[0]), ['sales.total', '__proto__', 'constructor']);
});

test('empty results have no rows and retain the supplied schema', () => {
  const table = tableFor([field('value', 'string')], []);
  assert.deepEqual(table.getRowModel().rows, []);
  assert.equal(table.getVisibleLeafColumns()[0].columnDef.header, 'value');
});
