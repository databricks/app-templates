import type { PublishedChartDomain, PublishedChartRow } from './chartTranslation';

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Normalize for comparisons only; keep the original value for labels and table display.
export function chartDomainKey(value: unknown, type: PublishedChartDomain['valueType']): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (type === 'quantitative') {
    return numericValue(value) ?? String(value);
  }
  if (type === 'temporal') {
    const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    // Designer's formatted week labels, for example, aren't parseable dates.
    return Number.isFinite(time) ? time : String(value);
  }
  if (type === 'boolean') {
    return value === true || value === 'true' ? 1 : 0;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function compareNatural(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }
  if (left === null || right === null) {
    return left === null ? -1 : 1;
  }
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right));
}

export function sortedChartDomain(
  rows: readonly PublishedChartRow[],
  domain: PublishedChartDomain,
): unknown[] {
  const { field, valueType, sort } = domain;
  const groups = new Map<unknown, { value: unknown; total: number | null }>();
  for (const row of rows) {
    const value = chartDomainKey(row[field], valueType);
    let group = groups.get(value);
    if (group === undefined) {
      group = { value: row[field], total: null };
      groups.set(value, group);
    }
    if (sort.by === 'measure' || sort.by === 'measure-reversed') {
      const measure = numericValue(row[sort.field]);
      if (measure !== null) {
        group.total = (group.total ?? 0) + measure;
      }
    }
  }

  const values = [...groups.keys()];
  switch (sort.by) {
    case 'natural-order':
    case 'natural-order-reversed':
      values.sort(compareNatural);
      break;
    case 'custom-order': {
      const ranks = new Map<unknown, number>();
      for (const value of sort.orderedValues) {
        const key = chartDomainKey(value, valueType);
        if (!ranks.has(key)) {
          ranks.set(key, ranks.size);
        }
      }
      values.sort((a, b) => {
        const aRank = ranks.get(a) ?? ranks.size;
        const bRank = ranks.get(b) ?? ranks.size;
        return aRank - bRank || compareNatural(a, b);
      });
      break;
    }
    case 'measure':
    case 'measure-reversed':
      values.sort((a, b) => {
        const left = groups.get(a)?.total ?? null;
        const right = groups.get(b)?.total ?? null;
        // Designer sorts aggregated measures with null totals last (before reversing).
        return left === right ? 0 : left === null ? 1 : right === null ? -1 : left - right;
      });
      break;
  }
  // Reverse the domain, not the input rows: tied categories reverse, rows within a category don't.
  if (sort.by.endsWith('-reversed')) {
    values.reverse();
  }
  return values.map((value) => groups.get(value)?.value);
}
