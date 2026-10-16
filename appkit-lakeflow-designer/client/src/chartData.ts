import { chartDomainKey, sortedChartDomain } from './chartSorting';
import type { PublishedChartDomain, PublishedChartPlan, PublishedChartRow } from './chartTranslation';

type ChartValue = string | number | boolean | null;

export interface PublishedChartDatum {
  x: ChartValue;
  y: ChartValue;
  color: ChartValue;
  order: number;
  colorOrder: number;
}

export interface PublishedChartData {
  data: PublishedChartDatum[];
  dimensionValues?: ChartValue[];
  colorValues: ChartValue[];
  // Colors follow Designer's default domain even when an explicit sort reorders marks/legend.
  colorIndexes: number[];
}

function chartValue(value: unknown): ChartValue {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function coerce(value: unknown, to: 'number' | 'date'): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const number =
    to === 'number' ? Number(value) : new Date(value instanceof Date ? value.getTime() : String(value)).getTime();
  return Number.isFinite(number) ? number : null;
}

function domainRanks(values: readonly unknown[], domain: PublishedChartDomain): Map<unknown, number> {
  return new Map(values.map((value, index) => [chartDomainKey(value, domain.valueType), index]));
}

export function preparePublishedChartData(
  plan: PublishedChartPlan,
  rows: readonly PublishedChartRow[],
): PublishedChartData {
  const data = rows.map((row) => {
    const next = { ...row };
    for (const { field, to } of plan.coercions) next[field] = coerce(row[field], to);
    return next;
  });
  const dimensionValues = plan.dimension ? sortedChartDomain(data, plan.dimension) : undefined;
  const ranks = plan.dimension ? domainRanks(dimensionValues ?? [], plan.dimension) : undefined;
  const colorDomain = plan.component === 'pie' ? plan.dimension : plan.series;
  const colorValues = colorDomain ? sortedChartDomain(data, colorDomain) : [];
  const colorRanks = colorDomain ? domainRanks(colorValues, colorDomain) : undefined;
  const defaultValues = colorDomain
    ? sortedChartDomain(data, {
        ...colorDomain,
        sort: plan.component === 'pie' ? { by: 'measure-reversed', field: plan.yKey } : { by: 'natural-order' },
      })
    : [];
  const defaultRanks = colorDomain ? domainRanks(defaultValues, colorDomain) : undefined;

  return {
    // Fixed field names avoid Vega treating dots/brackets in SQL column names as nested paths.
    // No wide-format pivot: categories named like columns cannot collide or disappear.
    data: data
      .map((row) => {
        const order = plan.dimension
          ? (ranks?.get(chartDomainKey(row[plan.dimension.field], plan.dimension.valueType)) ?? 0)
          : Number(row[plan.xKey]);
        const colorOrder = colorDomain
          ? (colorRanks?.get(chartDomainKey(row[colorDomain.field], colorDomain.valueType)) ?? 0)
          : 0;
        // Values such as numeric 2 and JSON "002" share one category and its first display label.
        const dimensionValue = chartValue(dimensionValues?.[order]);
        return {
          x: plan.dimension?.field === plan.xKey ? dimensionValue : chartValue(row[plan.xKey]),
          y: plan.dimension?.field === plan.yKey ? dimensionValue : chartValue(row[plan.yKey]),
          color: colorDomain ? chartValue(colorValues[colorOrder]) : null,
          order,
          colorOrder,
        };
      })
      .sort((a, b) => a.order - b.order),
    dimensionValues: dimensionValues?.map(chartValue),
    colorValues: colorValues.map(chartValue),
    colorIndexes: colorDomain
      ? colorValues.map((value) => defaultRanks?.get(chartDomainKey(value, colorDomain.valueType)) ?? 0)
      : [],
  };
}
