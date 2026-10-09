import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { build } from 'tsdown';
import { compile } from 'vega-lite';
import { parse, View } from 'vega';

import { translatePublishedChart } from '../client/src/chartTranslation.ts';

let buildPublishedVegaLiteSpec;
let preparePublishedChartData;
let outputDirectory;
before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), 'designer-chart-test-'));
  await build({
    entry: ['client/src/chartSpec.ts', 'client/src/chartData.ts'],
    config: false,
    outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  ({ buildPublishedVegaLiteSpec } = await import(pathToFileURL(join(outputDirectory, 'chartSpec.mjs')).href));
  ({ preparePublishedChartData } = await import(pathToFileURL(join(outputDirectory, 'chartData.mjs')).href));
});
after(async () => {
  if (outputDirectory !== undefined) await rm(outputDirectory, { recursive: true });
});

const schema = [
  { name: 'sellingprice', type: 'double' },
  { name: 'count', type: 'long' },
];
const labelSchema = [{ name: 'sellingprice', type: 'string' }, schema[1]];
const spec = {
  widgetType: 'bar',
  encodings: {
    x: { fieldName: 'sellingprice', scale: { type: 'categorical' }, displayName: 'price range' },
    y: { fieldName: 'count', scale: { type: 'quantitative' }, displayName: 'count' },
  },
  frame: { title: 'Fords Sold in 2015 by Selling Price', showTitle: true },
};
const ui = { axisLabel: '#555', axisTitle: '#222', grid: '#ddd', tooltipBg: '#fff' };
const colors = ['#123456', '#abcdef', '#987654'];

function planFor(chartSpec = spec, fields = schema) {
  const result = translatePublishedChart({ chartSpec, schema: fields });
  assert.equal(result.ok, true);
  return result.plan;
}

function chartFor(plan = planFor(), rows = [{ sellingprice: 1000, count: 2 }]) {
  return buildPublishedVegaLiteSpec(plan, preparePublishedChartData(plan, rows), colors, ui);
}

function sortedSpec(sort) {
  return {
    ...spec,
    encodings: { ...spec.encodings, x: { ...spec.encodings.x, scale: { type: 'categorical', sort } } },
  };
}

function seriesPlan(sort, colorSort, fields = labelSchema, mark) {
  const chartSpec = sortedSpec(sort);
  return planFor(
    {
      ...chartSpec,
      mark,
      encodings: {
        ...chartSpec.encodings,
        color: { fieldName: 'series', scale: { type: 'categorical', sort: colorSort } },
      },
    },
    [...fields, { name: 'series', type: 'string' }],
  );
}

function piePlan(sort) {
  return planFor(
    { ...spec, widgetType: 'pie', encodings: { color: sortedSpec(sort).encodings.x, angle: spec.encodings.y } },
    labelSchema,
  );
}

const seriesRows = [
  { sellingprice: 'B', series: 'Beta', count: '6', priority: '1' },
  { sellingprice: 'A', series: 'Alpha', count: null, priority: '20' },
  { sellingprice: 'B', series: 'Alpha', count: '5', priority: '1' },
  { sellingprice: 'A', series: 'Beta', count: '8', priority: '20' },
];
const pieRows = [
  { sellingprice: '2025-12-01', count: 2 },
  { sellingprice: '2025-06-01', count: 4 },
  { sellingprice: '2025-01-01', count: 8 },
];

async function render(chart, check) {
  const warnings = [];
  const logger = {
    level: () => 0,
    debug() {},
    info() {},
    warn: (...args) => warnings.push(args),
    error: (...args) => {
      throw new Error(args.join(' '));
    },
  };
  const compiled = compile(chart, { logger }).spec;
  const view = new View(parse(compiled), { renderer: 'none', logger });
  try {
    await view.runAsync();
    const svg = await view.toSVG();
    assert.ok(svg.startsWith('<svg'));
    assert.doesNotMatch(svg, /NaN|Infinity/);
    assert.deepEqual(warnings, [], 'the actual compiler/runtime must accept the chart without warnings');
    await check?.(view, svg);
  } finally {
    view.finalize();
  }
}

test('default string sorting matches Designer, including lexicographic price buckets', () => {
  const rows = [
    { sellingprice: '$5,000 - $9,999', count: 1 },
    { sellingprice: '$45,000 - $49,999', count: 2 },
    { sellingprice: '$10,000 - $14,999', count: 3 },
  ];
  for (const widgetType of ['bar', 'line', 'area']) {
    const chart = chartFor(planFor({ ...spec, widgetType }, labelSchema), rows);
    assert.deepEqual(chart.encoding.x.scale.domain, ['$10,000 - $14,999', '$45,000 - $49,999', '$5,000 - $9,999']);
    assert.deepEqual(
      chart.data.values.map(({ y }) => y),
      [3, 2, 1],
    );
  }
  assert.equal(rows[0].count, 1);
});

test('numeric categories sort by schema type without changing labels or dropping nulls', () => {
  const rows = [
    { sellingprice: '10', count: 1 },
    { sellingprice: '002', count: 2 },
    { sellingprice: null, count: 3 },
  ];
  const chart = chartFor(planFor(), rows);
  assert.deepEqual(chart.encoding.x.scale.domain, [null, '002', '10']);
  assert.deepEqual(
    chart.data.values.map(({ y }) => y),
    [3, 2, 1],
  );
  assert.deepEqual(chartFor(planFor(sortedSpec({ by: 'natural-order-reversed' })), rows).encoding.x.scale.domain, [
    '10',
    '002',
    null,
  ]);
});

test('explicit custom order naturally sorts omitted values and ignores duplicate entries', () => {
  const chart = chartFor(
    planFor(sortedSpec({ by: 'custom-order', orderedValues: ['B', 'B', 'absent', 'A'] }), labelSchema),
    ['D', 'A', 'C', 'B'].map((sellingprice, count) => ({ sellingprice, count })),
  );
  assert.deepEqual(chart.encoding.x.scale.domain, ['B', 'A', 'C', 'D']);
  assert.deepEqual(
    chart.data.values.map(({ y }) => y),
    [3, 1, 2, 0],
  );
});

for (const by of ['original-order', 'original-order-reversed', 'y', 'y-reversed']) {
  test(`explicit ${by} sorts categories without aggregating duplicate rows`, () => {
    const chart = chartFor(planFor(sortedSpec({ by }), labelSchema), [
      { sellingprice: 'B', count: 5 },
      { sellingprice: 'A', count: 8 },
      { sellingprice: 'B', count: 6 },
    ]);
    const bFirst = by === 'original-order' || by === 'y-reversed';
    assert.deepEqual(chart.encoding.x.scale.domain, bFirst ? ['B', 'A'] : ['A', 'B']);
    assert.deepEqual(
      chart.data.values.map(({ y }) => y),
      bFirst ? [5, 6, 8] : [8, 5, 6],
    );
  });
}

for (const sort of [undefined, { by: 'x-reversed' }]) {
  test(`horizontal bars honor ${sort?.by ?? 'default'} sort from top to bottom in Vega`, async () => {
    const plan = planFor(
      { ...spec, encodings: { x: spec.encodings.y, y: { ...spec.encodings.x, scale: { type: 'categorical', sort } } } },
      labelSchema,
    );
    const chart = chartFor(plan, [
      { sellingprice: 'B', count: 5 },
      { sellingprice: 'A', count: 2 },
    ]);
    assert.equal(plan.xKey, 'count');
    assert.equal(plan.yKey, 'sellingprice');
    assert.equal(chart.mark.orient, 'horizontal');
    const expected = sort ? ['B', 'A'] : ['A', 'B'];
    assert.deepEqual(chart.encoding.y.scale.domain, expected);
    await render(chart, (view) => {
      assert.deepEqual(view.scale('y').domain(), expected);
      assert.ok(view.scale('y')(expected[0]) < view.scale('y')(expected[1]));
    });
  });
}

test('boolean and temporal categories use typed sorting while preserving labels', () => {
  for (const { type, values, expected } of [
    { type: 'boolean', values: [true, false], expected: [false, true] },
    {
      type: 'timestamp',
      values: ['2025-01-01T01:00:00+02:00', '2025-01-01T00:30:00+02:00'],
      expected: ['2025-01-01T00:30:00+02:00', '2025-01-01T01:00:00+02:00'],
    },
  ]) {
    const chart = chartFor(
      planFor(spec, [{ name: 'sellingprice', type }, schema[1]]),
      values.map((sellingprice, count) => ({ sellingprice, count })),
    );
    assert.deepEqual(chart.encoding.x.scale.domain, expected);
    assert.deepEqual(
      chart.data.values.map(({ y }) => y),
      [1, 0],
    );
  }
});

test('numeric custom order matches JSON string values and naturally sorts unlisted values', () => {
  const chart = chartFor(
    planFor(sortedSpec({ by: 'custom-order', orderedValues: [10, 2] })),
    ['20', '002', '3', '10'].map((sellingprice, count) => ({ sellingprice, count })),
  );
  assert.deepEqual(chart.encoding.x.scale.domain, ['10', '002', '3', '20']);
  assert.deepEqual(
    chart.data.values.map(({ y }) => y),
    [3, 1, 2, 0],
  );
});

test('measure sorting ranks category totals and preserves the long-format series', () => {
  const chart = chartFor(seriesPlan({ by: 'y-reversed' }, { by: 'natural-order-reversed' }), seriesRows);
  assert.deepEqual(chart.encoding.x.scale.domain, ['B', 'A']);
  assert.deepEqual(chart.encoding.color.scale.domain, ['Beta', 'Alpha']);
  assert.deepEqual(chart.encoding.color.scale.range, [colors[1], colors[0]]);
  assert.deepEqual(
    chart.data.values.map(({ x, y, color }) => ({ x, y, color })),
    [
      { x: 'B', y: 6, color: 'Beta' },
      { x: 'B', y: 5, color: 'Alpha' },
      { x: 'A', y: null, color: 'Alpha' },
      { x: 'A', y: 8, color: 'Beta' },
    ],
  );
  assert.equal(seriesRows[0].count, '6');
});

test('a custom measure remains available for sorting without leaking into the chart dataset', () => {
  const chart = chartFor(
    seriesPlan({ by: 'measure-reversed', measure: { fieldName: 'priority' } }, undefined, [
      ...labelSchema,
      { name: 'priority', type: 'double' },
    ]),
    seriesRows,
  );
  assert.deepEqual(chart.encoding.x.scale.domain, ['A', 'B']);
  assert.equal(chart.data.values[0].priority, undefined);
});

for (const sort of [{ by: 'y-reversed' }, { by: 'custom-order', orderedValues: ['Beta'] }]) {
  test(`series ${sort.by} preserves category colors`, async () => {
    const chart = chartFor(seriesPlan(undefined, sort), seriesRows);
    assert.deepEqual(chart.encoding.color.scale.domain, ['Beta', 'Alpha']);
    assert.deepEqual(chart.encoding.color.scale.range, [colors[1], colors[0]]);
    await render(chart, (view) => {
      assert.equal(view.scale('color')('Alpha'), colors[0]);
      assert.equal(view.scale('color')('Beta'), colors[1]);
    });
  });
}

test('numeric series labels sort numerically', () => {
  const plan = planFor({ ...spec, encodings: { ...spec.encodings, color: { fieldName: 'series' } } }, [
    ...schema,
    { name: 'series', type: 'int' },
  ]);
  assert.deepEqual(
    chartFor(plan, [
      { sellingprice: 1, series: '10', count: 8 },
      { sellingprice: 1, series: '2', count: 3 },
    ]).encoding.color.scale.domain,
    ['2', '10'],
  );
});

test('measure sort preserves ties and null totals without turning blanks into zero', () => {
  const rows = [
    { sellingprice: 'A', count: 5 },
    { sellingprice: 'B', count: 5 },
    { sellingprice: 'C', count: ' ' },
    { sellingprice: 'D', count: null },
  ];
  assert.deepEqual(chartFor(planFor(sortedSpec({ by: 'y' }), labelSchema), rows).encoding.x.scale.domain, [
    'A',
    'B',
    'C',
    'D',
  ]);
  const chart = chartFor(planFor(sortedSpec({ by: 'y-reversed' }), labelSchema), rows);
  assert.deepEqual(chart.encoding.x.scale.domain, ['D', 'C', 'B', 'A']);
  assert.deepEqual(
    chart.data.values.map(({ y }) => y),
    [null, null, 5, 5],
  );
});

test('pies default to descending angle totals without aggregating returned rows', () => {
  const chart = chartFor(piePlan(), [
    { sellingprice: 'B', count: 5 },
    { sellingprice: 'A', count: 8 },
    { sellingprice: 'B', count: 6 },
  ]);
  assert.deepEqual(chart.encoding.color.scale.domain, ['B', 'A']);
  assert.deepEqual(
    chart.data.values.map(({ x, y }) => [x, y]),
    [
      ['B', 5],
      ['B', 6],
      ['A', 8],
    ],
  );
});

for (const sort of [
  { by: 'angle' },
  { by: 'natural-order-reversed' },
  { by: 'custom-order', orderedValues: ['2025-12-01', '2025-06-01'] },
]) {
  test(`pie explicit ${sort.by} preserves slice order and colors in Vega`, async () => {
    const chart = chartFor(piePlan(sort), pieRows);
    assert.deepEqual(
      chart.encoding.color.scale.domain,
      pieRows.map(({ sellingprice }) => sellingprice),
    );
    assert.deepEqual(chart.encoding.color.scale.range, [...colors].reverse());
    assert.deepEqual(
      chart.data.values.map(({ y }) => y),
      [2, 4, 8],
    );
    await render(chart);
  });
}

test('missing sort fields and unsupported sorts fall back to rows', () => {
  assert.deepEqual(
    translatePublishedChart({ chartSpec: sortedSpec({ by: 'measure', measure: { fieldName: 'missing' } }), schema }),
    { ok: false, refusal: { reason: 'fieldNotInResult', fieldName: 'missing' } },
  );
  for (const sort of [{ by: 'unknown' }, { by: 'measure' }, { by: 'custom-order' }]) {
    assert.deepEqual(translatePublishedChart({ chartSpec: sortedSpec(sort), schema }), {
      ok: false,
      refusal: { reason: 'unsupportedSort', fieldName: 'sellingprice' },
    });
  }
});

test('empty categorical, grouped and pie results compile and render without fake data', async () => {
  for (const plan of [planFor(), seriesPlan(), piePlan()]) {
    const chart = chartFor(plan, []);
    assert.deepEqual(chart.data.values, []);
    await render(chart);
  }
});

test('Ford chart preserves category labels and vertical bars with Designer spacing', async () => {
  const plan = planFor();
  assert.equal(plan.xType, 'nominal');
  assert.deepEqual(plan.coercions, [{ field: 'count', to: 'number' }]);
  const chart = chartFor(plan, [
    { sellingprice: '001000', count: 2 },
    { sellingprice: '2000', count: 5 },
  ]);
  assert.equal(chart.mark.type, 'bar');
  assert.equal(chart.mark.orient, 'vertical');
  assert.equal(chart.config.scale.bandPaddingInner, 0.1);
  assert.equal(chart.config.scale.bandPaddingOuter, 0.05);
  await render(chart, (view, svg) => {
    assert.deepEqual(view.scale('x').domain(), ['001000', '2000']);
    assert.equal(view.scale('y').domain()[0], 0);
    assert.match(svg, /001000/);
    assert.match(svg, /price range/);
  });
});

test('hides the chart frame title while preserving axis titles and AppKit theme tokens', async () => {
  const chart = chartFor();
  assert.equal(chart.title, undefined);
  assert.equal(chart.encoding.x.title, 'price range');
  assert.equal(chart.encoding.y.title, 'count');
  assert.equal(chart.config.axis.labelColor, ui.axisLabel);
  assert.equal(chart.config.axis.titleColor, ui.axisTitle);
  assert.equal(chart.config.axis.gridColor, ui.grid);
  assert.equal(chart.config.axis.domain, false);
  assert.equal(chart.config.legend.titleColor, ui.axisTitle);
  await render(chart, (_view, svg) => {
    assert.ok(!svg.includes(spec.frame.title));
    assert.ok(svg.includes('price range'));
    assert.ok(svg.includes('count'));
  });
});

test('respects hidden chart titles and custom/hidden axis titles', () => {
  const chart = chartFor(
    planFor({
      ...spec,
      frame: { ...spec.frame, showTitle: false },
      encodings: {
        x: { ...spec.encodings.x, axis: { title: 'Sale price' } },
        y: { ...spec.encodings.y, axis: { hideTitle: true } },
      },
    }),
  );
  assert.equal(chart.title, undefined);
  assert.equal(chart.encoding.x.title, 'Sale price');
  assert.equal(chart.encoding.y.title, null);
});

test('uses schema types when a scale is absent', () => {
  assert.equal(
    planFor({ ...spec, encodings: { ...spec.encodings, x: { fieldName: 'sellingprice' } } }).xType,
    'quantitative',
  );
});

test('numeric axes use continuous coordinates with sorted values, not categories or dates', async () => {
  const chart = chartFor(
    planFor({
      ...spec,
      widgetType: 'line',
      encodings: {
        ...spec.encodings,
        x: { ...spec.encodings.x, scale: { type: 'quantitative', sort: { by: 'natural-order-reversed' } } },
      },
    }),
    [
      { sellingprice: 100, count: 5 },
      { sellingprice: 1, count: 2 },
    ],
  );
  assert.deepEqual(
    chart.data.values.map(({ x, y }) => [x, y]),
    [
      [1, 2],
      [100, 5],
    ],
  );
  assert.equal(chart.encoding.x.type, 'quantitative');
  await render(chart, (view) => assert.equal(view.scale('x').type, 'linear'));
});

test('date-looking categories and original order survive unrelated date columns', () => {
  const chart = chartFor(planFor(sortedSpec({ by: 'original-order' }), labelSchema), [
    { sellingprice: '2025-12-01', count: 3, created_date: '2025-01-01' },
    { sellingprice: '2025-01-01', count: 8, created_date: '2025-12-01' },
  ]);
  assert.equal(chart.encoding.x.type, 'nominal');
  assert.deepEqual(chart.encoding.x.scale.domain, ['2025-12-01', '2025-01-01']);
  assert.deepEqual(
    chart.data.values.map(({ y }) => y),
    [3, 8],
  );
});

test('temporal axes decode and sort dates without converting missing dates to the epoch', async () => {
  const plan = planFor({
    ...spec,
    widgetType: 'line',
    encodings: { ...spec.encodings, x: { ...spec.encodings.x, scale: { type: 'temporal' } } },
  });
  const chart = chartFor(plan, [
    { sellingprice: '2025-01-02', count: 2 },
    { sellingprice: new Date('2025-01-01'), count: 1 },
    { sellingprice: '', count: 3 },
  ]);
  assert.equal(chart.encoding.x.scale.type, 'utc');
  assert.deepEqual(
    chart.data.values.map(({ x }) => x),
    [null, Date.parse('2025-01-01'), Date.parse('2025-01-02')],
  );
  await render(chart);
});

for (const widgetType of ['line', 'area']) {
  for (const lineShape of [undefined, 'linear', 'smooth', 'step']) {
    test(`${widgetType} honors line shape ${lineShape ?? 'default (linear)'}`, async () => {
      const chart = chartFor(planFor({ ...spec, widgetType, mark: { lineShape } }), [
        { sellingprice: 1, count: 2 },
        { sellingprice: 2, count: 5 },
      ]);
      assert.equal(
        chart.mark.interpolate,
        lineShape === 'smooth' ? 'monotone' : lineShape === 'step' ? 'step-after' : 'linear',
      );
      await render(chart);
    });
  }
}

test('missing measures remain gaps and duplicate categories are not silently summed', () => {
  const chart = chartFor(planFor(), [
    { sellingprice: 1000, count: null },
    { sellingprice: 1000, count: 2 },
  ]);
  assert.deepEqual(
    chart.data.values.map(({ y }) => y),
    [null, 2],
  );
  assert.equal(chart.encoding.y.aggregate, undefined);
  assert.equal(chart.config.mark.invalid, 'break-paths-filter-domains');
});

test('series with column-like names and literal dot/bracket field names cannot collide', async () => {
  const plan = planFor(
    {
      widgetType: 'bar',
      encodings: {
        x: { fieldName: 'x.value[0]', scale: { type: 'categorical' } },
        y: { fieldName: '__proto__', scale: { type: 'quantitative' } },
        color: { fieldName: 'color' },
      },
    },
    [
      { name: 'x.value[0]', type: 'string' },
      { name: '__proto__', type: 'double' },
      { name: 'color', type: 'string' },
    ],
  );
  const row = JSON.parse('{"x.value[0]":"A","__proto__":4,"color":"x.value[0]"}');
  const chart = chartFor(plan, [row]);
  assert.equal(chart.data.values[0].y, 4);
  assert.equal(chart.data.values[0].color, 'x.value[0]');
  await render(chart);
});

for (const layout of [undefined, 'stack', 'group', 'layer', 'percent-stack']) {
  test(`series bars render Designer ${layout ?? 'default stacked'} layout`, async () => {
    const chart = chartFor(seriesPlan(undefined, undefined, labelSchema, { layout }), seriesRows);
    assert.equal(
      chart.encoding.y.stack,
      layout === 'percent-stack' ? 'normalize' : !layout || layout === 'stack' ? 'zero' : null,
    );
    assert.equal(Boolean(chart.encoding.xOffset), layout === 'group');
    await render(chart, (view) => {
      if (!layout || layout === 'stack') assert.ok(view.scale('y').domain().at(-1) >= 11);
      if (layout === 'percent-stack') assert.deepEqual(view.scale('y').domain(), [0, 1]);
    });
  });
}

test('color on the dimension uses layers instead of stacking a category over itself', () => {
  const plan = planFor({ ...spec, encodings: { ...spec.encodings, color: spec.encodings.x } });
  assert.equal(plan.layout, 'layer');
});

test('pie charts hide frame titles and default to Designer donut radius, with explicit full-pie support', async () => {
  for (const innerRadius of [undefined, 0, 75, 500, -10]) {
    const plan = planFor({
      ...spec,
      widgetType: 'pie',
      encodings: { color: spec.encodings.x, angle: spec.encodings.y },
      mark: { innerRadius },
    });
    const chart = chartFor(plan);
    assert.equal(chart.title, undefined);
    assert.equal(plan.xKey, 'sellingprice');
    assert.equal(plan.yKey, 'count');
    assert.equal(plan.innerRadius, Math.min(100, Math.max(0, innerRadius ?? 50)));
    await render(chart, (_view, svg) => {
      assert.ok(!svg.includes(spec.frame.title));
    });
  }
});

test('explicit axis visibility, label angle, bounds and reversal survive translation', async () => {
  const chart = chartFor(
    planFor({
      ...spec,
      encodings: {
        x: { ...spec.encodings.x, axis: { labelAngle: 45, hideLabels: true } },
        y: {
          ...spec.encodings.y,
          axis: { hideGrid: true },
          scale: { type: 'quantitative', domain: { min: 1, max: 10 }, reverse: true },
        },
      },
    }),
  );
  assert.equal(chart.encoding.x.axis.labelAngle, 45);
  assert.equal(chart.encoding.x.axis.labels, false);
  assert.equal(chart.encoding.y.axis.grid, false);
  await render(chart, (view) => {
    assert.deepEqual(view.scale('y').domain(), [1, 10]);
    assert.ok(view.scale('y')(1) < view.scale('y')(10));
  });
  assert.equal(
    chartFor(planFor({ ...spec, encodings: { ...spec.encodings, x: { ...spec.encodings.x, axis: { hide: true } } } }))
      .encoding.x.axis,
    null,
  );
});

test('categorical label rotation responds to width while the chart resizes', async () => {
  const chart = chartFor(planFor(spec, labelSchema), [
    { sellingprice: 'A long category label', count: 2 },
    { sellingprice: 'Another long category label', count: 5 },
  ]);
  await render(chart, async (view, svg) => {
    assert.doesNotMatch(svg, /rotate\(90\)/);
    await view.width(240).runAsync();
    assert.match(await view.toSVG(), /rotate\(90\)/);
  });
});

test('unsupported charts and missing result fields still fall back to rows', () => {
  assert.deepEqual(translatePublishedChart({ chartSpec: { ...spec, widgetType: 'box' }, schema }), {
    ok: false,
    refusal: { reason: 'unsupportedWidgetType', widgetType: 'box' },
  });
  assert.deepEqual(translatePublishedChart({ chartSpec: spec, schema: schema.slice(1) }), {
    ok: false,
    refusal: { reason: 'fieldNotInResult', fieldName: 'sellingprice' },
  });
});

test('equivalent typed categories and color values share their domain label without losing marks', async () => {
  const chart = chartFor(seriesPlan(undefined, undefined, schema), [
    { sellingprice: '002', count: 3, series: 'Alpha' },
    { sellingprice: 2, count: 4, series: 'Beta' },
  ]);
  assert.deepEqual(chart.encoding.x.scale.domain, ['002']);
  assert.deepEqual(
    chart.data.values.map(({ x }) => x),
    ['002', '002'],
  );
  await render(chart, (view, svg) => {
    assert.ok(view.scale('y').domain().at(-1) >= 7);
    assert.match(svg, /Count|count/);
  });
});

test('ordinary numeric axis ticks do not use scientific notation', async () => {
  await render(chartFor(planFor(), [{ sellingprice: 1, count: 213 }]), (_view, svg) => {
    assert.match(svg, />200<\/text>/);
    assert.doesNotMatch(svg, />[12]e\+2<\/text>/);
  });
});

test('all-missing measures render without invalid scale domains or fake zeros', async () => {
  for (const plan of [planFor(), seriesPlan(), piePlan()]) {
    const chart = chartFor(plan, [{ sellingprice: 'A', count: null, series: 'Alpha' }]);
    assert.equal(chart.data.values[0].y, null);
    await render(chart);
  }
});
