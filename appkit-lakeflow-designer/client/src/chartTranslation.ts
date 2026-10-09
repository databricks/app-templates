export type PublishedChartRow = Record<string, unknown>;

export interface PublishedChartField {
  name: string;
  type: string;
}

export interface PublishedChartSpecInput {
  widgetType: string;
  [key: string]: unknown;
}

export type PublishedChartFieldType = 'quantitative' | 'temporal' | 'nominal';

export type PublishedChartComponent = 'bar' | 'line' | 'area' | 'pie';

export interface PublishedChartCoercion {
  field: string;
  to: 'number' | 'date';
}

export type PublishedChartSort =
  | { by: 'natural-order' | 'natural-order-reversed' | 'original-order' | 'original-order-reversed' }
  | { by: 'custom-order'; orderedValues: unknown[] }
  | { by: 'measure' | 'measure-reversed'; field: string };

export interface PublishedChartDomain {
  field: string;
  // Compare categories using the column's data type, not its (categorical) scale type.
  valueType: PublishedChartFieldType | 'boolean';
  sort: PublishedChartSort;
}

export interface PublishedChartPlan {
  component: PublishedChartComponent;
  xKey: string;
  yKey: string;
  orientation: 'vertical' | 'horizontal';
  xType: PublishedChartFieldType;
  yType: PublishedChartFieldType;
  xAxis: PublishedChartAxis;
  yAxis: PublishedChartAxis;
  title?: string;
  lineShape: 'linear' | 'smooth' | 'step';
  layout: 'layer' | 'group' | 'stack' | 'percent-stack';
  innerRadius: number;

  dimension?: PublishedChartDomain;
  series?: PublishedChartDomain;
  colorTitle?: string;
  xTitle: string;
  yTitle: string;

  // JSON rows carry temporal and quantitative values as strings; decode them before charting.
  coercions: PublishedChartCoercion[];
}

export interface PublishedChartAxis {
  hide: boolean;
  hideLabels: boolean;
  hideGrid: boolean;
  labelAngle?: number;
  reverse: boolean;
  domainMin?: number;
  domainMax?: number;
}

export type PublishedChartRefusal =
  | { reason: 'unsupportedWidgetType'; widgetType: string }
  | { reason: 'missingChannel'; channel: string }
  | { reason: 'fieldNotInResult'; fieldName: string }
  | { reason: 'unsupportedSort'; fieldName: string }
  | { reason: 'noMeasure'; fieldNames: string[] };

export type PublishedChartTranslation =
  | { ok: true; plan: PublishedChartPlan }
  | { ok: false; refusal: PublishedChartRefusal };

const CARTESIAN: ReadonlyMap<string, 'bar' | 'line' | 'area'> = new Map([
  ['bar', 'bar'],
  ['line', 'line'],
  ['area', 'area'],
]);

// Used only when the chart has no explicit scale; numeric columns can be plotted as categories.
function fieldTypeOf(sparkType: string): PublishedChartFieldType {
  const type = sparkType.trim().toLowerCase();
  if (type === 'date' || type.startsWith('timestamp') || type === 'datetime') {
    return 'temporal';
  }
  if (
    type.startsWith('decimal') ||
    type.startsWith('numeric') ||
    type === 'tinyint' ||
    type === 'smallint' ||
    type === 'int' ||
    type === 'integer' ||
    type === 'bigint' ||
    type === 'long' ||
    type === 'short' ||
    type === 'byte' ||
    type === 'float' ||
    type === 'double' ||
    type === 'real'
  ) {
    return 'quantitative';
  }
  return 'nominal';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function axisOf(chartSpec: PublishedChartSpecInput, channel: string): PublishedChartAxis {
  const encoding = isRecord(chartSpec.encodings) ? chartSpec.encodings[channel] : undefined;
  const axis = isRecord(encoding) && isRecord(encoding.axis) ? encoding.axis : undefined;
  const scale = isRecord(encoding) && isRecord(encoding.scale) ? encoding.scale : undefined;
  const domain = isRecord(scale?.domain) ? scale.domain : undefined;
  return {
    hide: axis?.hide === true,
    hideLabels: axis?.hideLabels === true,
    hideGrid: axis?.hideGrid === true,
    labelAngle: finiteNumber(axis?.labelAngle),
    reverse: scale?.reverse === true,
    domainMin: finiteNumber(domain?.min),
    domainMax: finiteNumber(domain?.max),
  };
}

interface Bound {
  field: string;
  type: PublishedChartFieldType;
  title: string;
  valueType: PublishedChartDomain['valueType'];
  sort: unknown;
}

function channelOf(
  chartSpec: PublishedChartSpecInput,
  channel: string,
): { fieldName: string; title: string; type?: PublishedChartFieldType; sort: unknown } | undefined {
  const encodings = chartSpec.encodings;
  if (!isRecord(encodings)) {
    return undefined;
  }
  const encoding = encodings[channel];
  if (!isRecord(encoding) || typeof encoding.fieldName !== 'string' || encoding.fieldName === '') {
    return undefined;
  }

  const displayName =
    typeof encoding.displayName === 'string' && encoding.displayName !== '' ? encoding.displayName : undefined;
  const axis = isRecord(encoding.axis) ? encoding.axis : undefined;
  const title =
    axis?.hideTitle === true ? '' : typeof axis?.title === 'string' ? axis.title : (displayName ?? encoding.fieldName);
  const scale = isRecord(encoding.scale) ? encoding.scale.type : undefined;
  const type =
    scale === 'categorical' ? 'nominal' : scale === 'quantitative' || scale === 'temporal' ? scale : undefined;
  return {
    fieldName: encoding.fieldName,
    title,
    type,
    sort: isRecord(encoding.scale) ? encoding.scale.sort : undefined,
  };
}

function bindChannel(
  chartSpec: PublishedChartSpecInput,
  channel: string,
  schema: readonly PublishedChartField[],
  overrideType?: PublishedChartFieldType,
): { ok: true; bound: Bound } | { ok: false; refusal: PublishedChartRefusal } {
  const declared = channelOf(chartSpec, channel);
  if (declared === undefined) {
    return { ok: false, refusal: { reason: 'missingChannel', channel } };
  }
  const field = schema.find((candidate) => candidate.name === declared.fieldName);
  if (field === undefined) {
    return { ok: false, refusal: { reason: 'fieldNotInResult', fieldName: declared.fieldName } };
  }
  return {
    ok: true,
    bound: {
      field: declared.fieldName,
      type: overrideType ?? declared.type ?? fieldTypeOf(field.type),
      title: declared.title,
      valueType: field.type.trim().toLowerCase() === 'boolean' ? 'boolean' : fieldTypeOf(field.type),
      sort: declared.sort,
    },
  };
}

function categoricalDomainOf(
  bound: Bound,
  chartSpec: PublishedChartSpecInput,
  schema: readonly PublishedChartField[],
  defaultSort: PublishedChartSort = { by: 'natural-order' },
): { ok: true; domain?: PublishedChartDomain } | { ok: false; refusal: PublishedChartRefusal } {
  if (bound.type !== 'nominal') {
    return { ok: true };
  }
  const domain = (sort: PublishedChartSort) => ({
    ok: true as const,
    domain: { field: bound.field, valueType: bound.valueType, sort },
  });
  if (bound.sort === undefined || bound.sort === null) {
    return domain(defaultSort);
  }
  const sort = isRecord(bound.sort) ? bound.sort : {};
  switch (sort.by) {
    case 'natural-order':
    case 'natural-order-reversed':
    case 'original-order':
    case 'original-order-reversed':
      return domain({ by: sort.by });
    case 'custom-order':
      if (Array.isArray(sort.orderedValues)) {
        return domain({ by: sort.by, orderedValues: sort.orderedValues });
      }
      break;
    case 'x':
    case 'x-reversed':
    case 'y':
    case 'y-reversed':
    case 'angle':
    case 'angle-reversed': {
      const measure = bindChannel(chartSpec, sort.by.replace('-reversed', ''), schema);
      if (!measure.ok) {
        return measure;
      }
      if (measure.bound.type === 'quantitative') {
        return domain({
          by: sort.by.endsWith('-reversed') ? 'measure-reversed' : 'measure',
          field: measure.bound.field,
        });
      }
      break;
    }
    case 'measure':
    case 'measure-reversed': {
      const fieldName = isRecord(sort.measure) ? sort.measure.fieldName : undefined;
      if (typeof fieldName !== 'string') {
        break;
      }
      const field = schema.find((candidate) => candidate.name === fieldName);
      if (field === undefined) {
        return { ok: false, refusal: { reason: 'fieldNotInResult', fieldName } };
      }
      if (fieldTypeOf(field.type) === 'quantitative') {
        return domain({ by: sort.by, field: fieldName });
      }
      break;
    }
  }
  return { ok: false, refusal: { reason: 'unsupportedSort', fieldName: bound.field } };
}

function coercionsOf(...bounds: Bound[]): PublishedChartCoercion[] {
  return bounds.flatMap((bound): PublishedChartCoercion[] => {
    if (bound.type === 'quantitative') {
      return [{ field: bound.field, to: 'number' }];
    }
    if (bound.type === 'temporal') {
      return [{ field: bound.field, to: 'date' }];
    }
    return [];
  });
}

export function translatePublishedChart({
  chartSpec,
  schema,
}: {
  chartSpec: PublishedChartSpecInput;
  schema: readonly PublishedChartField[];
}): PublishedChartTranslation {
  const frame = isRecord(chartSpec.frame) ? chartSpec.frame : undefined;
  const title = frame?.showTitle === true && typeof frame.title === 'string' ? frame.title : undefined;
  const mark = isRecord(chartSpec.mark) ? chartSpec.mark : undefined;
  const lineShape = mark?.lineShape === 'smooth' || mark?.lineShape === 'step' ? mark.lineShape : 'linear';
  const xAxis = axisOf(chartSpec, 'x');
  const yAxis = axisOf(chartSpec, 'y');
  const innerRadius = Math.min(100, Math.max(0, finiteNumber(mark?.innerRadius) ?? 50));
  const cartesian = CARTESIAN.get(chartSpec.widgetType);
  if (cartesian !== undefined) {
    const x = bindChannel(chartSpec, 'x', schema);
    if (!x.ok) {
      return x;
    }
    const y = bindChannel(chartSpec, 'y', schema);
    if (!y.ok) {
      return y;
    }

    if (x.bound.type !== 'quantitative' && y.bound.type !== 'quantitative') {
      return { ok: false, refusal: { reason: 'noMeasure', fieldNames: [x.bound.field, y.bound.field] } };
    }
    const color = bindChannel(chartSpec, 'color', schema, 'nominal');
    // A color/series channel is optional on a cartesian chart, but if the spec declares one whose
    // field the run didn't return, refuse rather than silently drawing an ungrouped chart.
    if (!color.ok && color.refusal.reason !== 'missingChannel') {
      return color;
    }
    const horizontal = cartesian === 'bar' && x.bound.type === 'quantitative' && y.bound.type === 'nominal';
    const dimension = categoricalDomainOf(horizontal ? y.bound : x.bound, chartSpec, schema);
    if (!dimension.ok) {
      return dimension;
    }
    const series = color.ok ? categoricalDomainOf(color.bound, chartSpec, schema) : undefined;
    if (series && !series.ok) {
      return series;
    }
    const sameColorAndDimension = color.ok && color.bound.field === (horizontal ? y.bound.field : x.bound.field);
    const layout = sameColorAndDimension
      ? 'layer'
      : mark?.layout === 'stack' ||
          mark?.layout === 'group' ||
          mark?.layout === 'layer' ||
          mark?.layout === 'percent-stack'
        ? mark.layout
        : cartesian === 'area' || (cartesian === 'bar' && color.ok)
          ? 'stack'
          : 'layer';
    return {
      ok: true,
      plan: {
        component: cartesian,
        xKey: x.bound.field,
        yKey: y.bound.field,
        orientation: horizontal ? 'horizontal' : 'vertical',
        xType: x.bound.type,
        yType: y.bound.type,
        xAxis,
        yAxis,
        title,
        lineShape,
        layout,
        innerRadius,
        dimension: dimension.domain,
        series: series?.domain,
        colorTitle: color.ok ? color.bound.title : undefined,
        xTitle: x.bound.title,
        yTitle: y.bound.title,
        coercions: coercionsOf(x.bound, y.bound),
      },
    };
  }

  if (chartSpec.widgetType === 'pie') {
    const angle = bindChannel(chartSpec, 'angle', schema);
    if (!angle.ok) {
      return angle;
    }
    if (angle.bound.type !== 'quantitative') {
      return { ok: false, refusal: { reason: 'noMeasure', fieldNames: [angle.bound.field] } };
    }

    const color = bindChannel(chartSpec, 'color', schema, 'nominal');
    if (!color.ok) {
      return color;
    }
    const dimension = categoricalDomainOf(color.bound, chartSpec, schema, {
      by: 'measure-reversed',
      field: angle.bound.field,
    });
    if (!dimension.ok) {
      return dimension;
    }
    return {
      ok: true,
      plan: {
        component: 'pie',
        xKey: color.bound.field,
        yKey: angle.bound.field,
        orientation: 'vertical',
        xType: color.bound.type,
        yType: angle.bound.type,
        xAxis,
        yAxis,
        title,
        lineShape,
        layout: 'stack',
        innerRadius,
        dimension: dimension.domain,
        colorTitle: color.bound.title,
        xTitle: color.bound.title,
        yTitle: angle.bound.title,
        coercions: coercionsOf(angle.bound),
      },
    };
  }

  return { ok: false, refusal: { reason: 'unsupportedWidgetType', widgetType: chartSpec.widgetType } };
}

export function describePublishedChartRefusal(refusal: PublishedChartRefusal): string {
  switch (refusal.reason) {
    case 'unsupportedWidgetType':
      return `This output is published as a ${refusal.widgetType} chart, which a published app cannot draw yet. Its rows are shown instead.`;
    case 'missingChannel':
      return `This output's chart has no ${refusal.channel} column configured, so it cannot be drawn. Its rows are shown instead.`;
    case 'fieldNotInResult':
      return `This output's chart uses a column called "${refusal.fieldName}", which the run did not return. Its rows are shown instead.`;
    case 'unsupportedSort':
      return `This output's chart uses an unsupported sort for "${refusal.fieldName}". Its rows are shown instead.`;
    case 'noMeasure':
      return `This output's chart has nothing numeric to measure (${refusal.fieldNames.join(', ')}), so it cannot be drawn. Its rows are shown instead.`;
  }
}
