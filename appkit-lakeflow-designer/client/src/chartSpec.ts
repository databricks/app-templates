import type { ChartUITokens } from '@databricks/appkit-ui/react';
import type { Config, TopLevelSpec } from 'vega-lite';
import type { PositionFieldDef } from 'vega-lite/types_unstable/channeldef.js';

import type { PublishedChartData } from './chartData';
import type { PublishedChartPlan } from './chartTranslation';

// Designer's default visualization palette; independent of AppKit's general UI accent colors.
export const DESIGNER_CHART_COLORS = [
  '#077A9D',
  '#FFAB00',
  '#00A972',
  '#FF3621',
  '#8BCAE7',
  '#AB4057',
  '#99DDB4',
  '#FCA4A1',
  '#919191',
  '#BF7080',
];

export function buildPublishedVegaLiteSpec(
  plan: PublishedChartPlan,
  data: PublishedChartData,
  colors: string[],
  ui: ChartUITokens,
  font = 'Arial, sans-serif',
): TopLevelSpec {
  const config: Config = {
    font,
    numberFormat: ',~f',
    background: 'transparent',
    view: { stroke: null },
    mark: { color: colors[0], invalid: 'break-paths-filter-domains' },
    bar: { binSpacing: 3, continuousBandSize: 10 },
    line: { strokeCap: 'round', strokeJoin: 'round' },
    area: { opacity: 0.5, line: { strokeCap: 'round', strokeJoin: 'round' } },
    axis: {
      domain: false,
      gridColor: ui.grid,
      tickColor: ui.grid,
      labelColor: ui.axisLabel,
      titleColor: ui.axisTitle,
      labelFontSize: 12,
      titleFontSize: 13,
      titleFontWeight: 700,
      titlePadding: 10,
      labelPadding: 5,
      labelOverlap: true,
    },
    legend: {
      orient: 'bottom',
      direction: 'horizontal',
      title: null,
      titleColor: ui.axisTitle,
      titleFontSize: 13,
      titleFontWeight: 700,
      labelColor: ui.axisLabel,
      labelFontSize: 12,
      symbolType: 'circle',
      symbolSize: 64,
      labelLimit: 140,
      columns: { expr: 'max(1,floor(width/180))' },
      columnPadding: 12,
      rowPadding: 4,
    },
    scale: { bandPaddingInner: 0.1, bandPaddingOuter: 0.05, zero: false },
  };
  // Designer hides the widget frame; the output block supplies the visible title.
  const common = {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: data.data },
    width: 600,
    height: 320,
    autosize: { type: 'fit', contains: 'padding', resize: true } as const,
    padding: 8,
    config,
  };
  const color =
    plan.series || plan.component === 'pie'
      ? {
          field: 'color',
          type: 'nominal' as const,
          title: plan.colorTitle,
          sort: { field: 'colorOrder', op: 'min' as const, order: 'ascending' as const },
          scale: {
            domain: data.colorValues,
            range: data.colorIndexes.map((index) => colors[index % colors.length]),
          },
        }
      : { value: colors[0] };
  const tooltip = [
    { field: 'x', type: plan.xType, title: plan.xTitle || plan.xKey },
    { field: 'y', type: plan.yType, title: plan.yTitle || plan.yKey },
    ...(plan.series && plan.series.field !== plan.xKey && plan.series.field !== plan.yKey
      ? [{ field: 'color', type: 'nominal' as const, title: plan.colorTitle || plan.series.field }]
      : []),
  ];

  if (plan.component === 'pie') {
    return {
      ...common,
      mark: {
        type: 'arc',
        // Designer's innerRadius is a percentage, defaulting to a 50% donut hole.
        innerRadius: { expr: `min(width,height) * ${plan.innerRadius / 200}` },
      },
      encoding: {
        theta: {
          field: 'y',
          type: 'quantitative',
          stack: data.data.some((row) => row.y !== null) ? true : null,
          ...(!data.data.some((row) => row.y !== null) ? { scale: { domain: [0, 1] } } : {}),
        },
        color,
        order: { field: 'order', type: 'quantitative', sort: 'ascending' },
        tooltip,
      },
    };
  }

  const horizontal = plan.orientation === 'horizontal';
  const hasMeasures = data.data.some((row) => row[horizontal ? 'x' : 'y'] !== null);
  const stack = !hasMeasures
    ? null
    : plan.layout === 'percent-stack'
      ? 'normalize'
      : plan.layout === 'stack'
        ? 'zero'
        : null;
  const grouped = plan.component === 'bar' && plan.layout === 'group' && plan.series && plan.dimension;
  const interpolate = plan.lineShape === 'smooth' ? 'monotone' : plan.lineShape === 'step' ? 'step-after' : 'linear';
  return {
    ...common,
    mark: { type: plan.component, orient: plan.orientation, interpolate, clip: true },
    encoding: {
      x: axisEncoding(plan, data, 'x', horizontal ? stack : null),
      y: axisEncoding(plan, data, 'y', horizontal ? null : stack),
      color,
      ...(grouped
        ? {
            [horizontal ? 'yOffset' : 'xOffset']: {
              field: 'color',
              type: 'nominal',
              sort: { field: 'colorOrder', op: 'min', order: 'ascending' },
            },
          }
        : {}),
      order: {
        field: stack && plan.series ? 'colorOrder' : 'order',
        type: 'quantitative',
        sort: 'ascending',
      },
      tooltip,
    },
  };
}

function axisEncoding(
  plan: PublishedChartPlan,
  data: PublishedChartData,
  channel: 'x' | 'y',
  stack: 'zero' | 'normalize' | null,
): PositionFieldDef<string> {
  const type = channel === 'x' ? plan.xType : plan.yType;
  const settings = channel === 'x' ? plan.xAxis : plan.yAxis;
  const categorical = type === 'nominal';
  const measureAxis = channel === (plan.orientation === 'horizontal' ? 'x' : 'y');
  const labelWidth = Math.max(0, ...(data.dimensionValues ?? []).map((value) => String(value).length * 7));
  const hasValues = data.data.some((row) => row[channel] !== null);
  return {
    field: channel,
    type,
    title: (channel === 'x' ? plan.xTitle : plan.yTitle) || null,
    ...(categorical ? { sort: { field: 'order', op: 'min' as const, order: 'ascending' as const } } : {}),
    ...(measureAxis ? { stack } : {}),
    scale: {
      ...(categorical
        ? { domain: data.dimensionValues }
        : {
            // Bars and areas need a zero baseline; lines use their data extent like Designer.
            ...(type === 'quantitative'
              ? { zero: measureAxis && (plan.component === 'bar' || plan.component === 'area') }
              : {}),
            ...(!hasValues ? { domain: [0, 1] } : {}),
            ...(settings.domainMin !== undefined
              ? { domainMin: settings.domainMin, ...(type === 'quantitative' ? { zero: false } : {}) }
              : {}),
            ...(settings.domainMax !== undefined ? { domainMax: settings.domainMax } : {}),
            ...(type === 'temporal' ? { type: 'utc' as const } : {}),
          }),
      reverse: settings.reverse,
    },
    axis: settings.hide
      ? null
      : {
          labels: !settings.hideLabels,
          grid: !settings.hideGrid && !categorical,
          labelAngle:
            settings.labelAngle ??
            (categorical && channel === 'x' ? { expr: `bandwidth('x') > ${labelWidth} ? 0 : 90` } : 0),
          labelLimit: categorical ? 180 : undefined,
          ...(type === 'quantitative' ? { format: stack === 'normalize' ? '.0%' : ',~f' } : {}),
          ...(!categorical ? { tickCount: { expr: `ceil(${channel === 'x' ? 'width' : 'height'}/50)` } } : {}),
        },
  };
}
