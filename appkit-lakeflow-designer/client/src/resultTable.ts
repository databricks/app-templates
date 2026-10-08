import type { ColumnDef, FilterFn } from '@tanstack/react-table';

import { categorize, formatCell, isNumericCategory } from './dataTypes';
import type { ResultRow, SchemaField } from './payload';

function compareDecimalStrings(left: string, right: string): number | undefined {
  const pattern = /^([+-]?)(\d+)(?:\.(\d+))?$/;
  const a = pattern.exec(left);
  const b = pattern.exec(right);
  if (!a || !b) return undefined;

  const aInteger = a[2].replace(/^0+/, '') || '0';
  const bInteger = b[2].replace(/^0+/, '') || '0';
  const aFraction = a[3] ?? '';
  const bFraction = b[3] ?? '';
  const aNegative = a[1] === '-' && /[1-9]/.test(aInteger + aFraction);
  const bNegative = b[1] === '-' && /[1-9]/.test(bInteger + bFraction);
  if (aNegative !== bNegative) return aNegative ? -1 : 1;

  const fractionLength = Math.max(aFraction.length, bFraction.length);
  const order = aInteger.length - bInteger.length
    || aInteger.localeCompare(bInteger)
    || aFraction.padEnd(fractionLength, '0').localeCompare(bFraction.padEnd(fractionLength, '0'));
  return aNegative ? -order : order;
}

export function compareResultValues(left: unknown, right: unknown, sparkType: string): number {
  if (left === right) return 0;
  if (left == null || right == null) return left == null ? (right == null ? 0 : -1) : 1;

  const category = categorize(sparkType);
  if (isNumericCategory(category)) {
    // Jobs carries large integers and decimals as strings; Number would collapse distinct values.
    const exact = compareDecimalStrings(String(left), String(right));
    if (exact !== undefined) return exact;
    const a = Number(left);
    const b = Number(right);
    if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
  }
  if (category === 'date' || category === 'timestamp') {
    const a = Date.parse(String(left));
    const b = Date.parse(String(right));
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
  }
  return (formatCell(left, category).text ?? '').localeCompare(formatCell(right, category).text ?? '');
}

export function createResultColumns(schema: SchemaField[]): ColumnDef<ResultRow>[] {
  return schema.map((field, index) => ({
    id: String(index),
    header: field.name,
    // SQL aliases may contain dots or match Object.prototype keys.
    accessorFn: (row) => row[field.name],
    sortDescFirst: false,
    sortUndefined: false,
    sortingFn: (a, b, id) => compareResultValues(a.getValue(id), b.getValue(id), field.type),
  }));
}

export function createResultFilter(schema: SchemaField[]): FilterFn<ResultRow> {
  return (row, columnId, value: unknown) => {
    const category = categorize(schema[Number(columnId)].type);
    const text = formatCell(row.getValue(columnId), category).text ?? 'null';
    return text.toLowerCase().includes(String(value).trim().toLowerCase());
  };
}
