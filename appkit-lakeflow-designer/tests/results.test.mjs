import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'tsdown';

let exportedModelToRunPayload;
let matchRunOutputs;
let parseRunOutcome;
let fetchLastRun;
let lastSuccessfulRunEntry;
let planRunDisplay;
let RunFailureAlert;
let shouldRetainSettledFollowedRun;
let ResultFooter;
let ResultGrid;
let OutputSection;
let PublishedBlocks;
let outputDirectory;
const ROW_COUNTS_MIME_TYPE = 'application/vnd.databricks.lakeflow-designer.row-counts+json';
const FILES_MIME_TYPE = 'application/vnd.databricks.lakeflow-designer.files+json';
const NODE_STATE_MIME_TYPE = 'application/vnd.databricks.lakebuilder.runtime-node-state+json';

before(async () => {
  // Keep React and AppKit resolvable from the generated modules without copying dependencies.
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.result-tests-', import.meta.url)));
  await build({
    entry: {
      exportedRunOutput: 'server/exportedRunOutput.ts',
      runOutputs: 'server/runOutputs.ts',
      payload: 'client/src/payload.ts',
      ResultFooter: 'client/src/ResultFooter.tsx',
      ResultGrid: 'client/src/ResultGrid.tsx',
      App: 'client/src/App.tsx',
      lastRun: 'client/src/lastRun.ts',
      landingPlan: 'client/src/landingPlan.ts',
    },
    config: false,
    tsconfig: 'tsconfig.client.json',
    // Match the client bundler's tree-shaking instead of loading AppKit's browser-only barrel in Node.
    noExternal: [/^@databricks\/appkit-ui(?:\/|$)/],
    outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  ({ exportedModelToRunPayload } = await import(pathToFileURL(join(outputDirectory, 'exportedRunOutput.mjs')).href));
  ({ matchRunOutputs } = await import(pathToFileURL(join(outputDirectory, 'runOutputs.mjs')).href));
  ({ parseRunOutcome } = await import(pathToFileURL(join(outputDirectory, 'payload.mjs')).href));
  ({ ResultFooter } = await import(pathToFileURL(join(outputDirectory, 'ResultFooter.mjs')).href));
  ({ ResultGrid } = await import(pathToFileURL(join(outputDirectory, 'ResultGrid.mjs')).href));
  ({ OutputSection, PublishedBlocks, lastSuccessfulRunEntry, planRunDisplay, RunFailureAlert } = await import(pathToFileURL(join(outputDirectory, 'App.mjs')).href));
  ({ fetchLastRun } = await import(pathToFileURL(join(outputDirectory, 'lastRun.mjs')).href));
  ({ shouldRetainSettledFollowedRun } = await import(pathToFileURL(join(outputDirectory, 'landingPlan.mjs')).href));
});

after(async () => {
  if (outputDirectory !== undefined) await rm(outputDirectory, { recursive: true });
});

function displayTable(rowCount, overflow) {
  return {
    type: 'table',
    schema: [{ name: 'value', type: '"long"', nullable: true }],
    data: Array.from({ length: rowCount }, (_, i) => [i]),
    ...(overflow === undefined ? {} : { overflow }),
  };
}

function rowCounts(node, counts) {
  return { type: 'mimeBundle', data: { [ROW_COUNTS_MIME_TYPE]: { node, counts } } };
}

function notebookHtml(commands) {
  const model = Buffer.from(encodeURIComponent(JSON.stringify({ commands }))).toString('base64');
  return `<script>__DATABRICKS_NOTEBOOK_MODEL = '${model}'</script>`;
}

function nodeState(nodeId, disabled) {
  return { type: 'mimeBundle', data: { [NODE_STATE_MIME_TYPE]: { nodeId, disabled } } };
}

function matchedRunOutputs(blocks, commands) {
  return parseRunOutcome(matchRunOutputs(blocks.filter((block) => block.type === 'output'),
    exportedModelToRunPayload(notebookHtml(commands))));
}

function publishedBlocksHtml(blocks, outputs, unmatchedState = 'omitted') {
  return renderToStaticMarkup(createElement(PublishedBlocks, {
    blocks, outputs, unmatchedState, downloadRunId: '42', onRetry: () => {},
  }));
}

test('runtime states do not shift table ports, row counts, or file receipts', () => {
  const files = { node: 'writer', files: [{ path: '/Volumes/main/apps/files/report.csv' }] };
  const html = notebookHtml([{
    command: 'display(ctx["source.data"])\ndisplay(ctx["source.summary"])',
    results: { data: [
      nodeState('source', false), displayTable(2, true),
      { type: 'mimeBundle', data: { [NODE_STATE_MIME_TYPE]: JSON.stringify({ nodeId: 'writer', disabled: true }) } },
      { type: 'mimeBundle', data: { [FILES_MIME_TYPE]: files } },
      displayTable(1, false), rowCounts('source', { data: 4000, summary: 1 }),
    ] },
  }]);
  const parsed = JSON.parse(exportedModelToRunPayload(html));
  assert.deepEqual(parsed.runtimeNodeStates, { source: { disabled: false }, writer: { disabled: true } });
  assert.deepEqual(parsed.outputs.map(({ target_node, target_port, total_row_count }) => ({
    target_node, target_port, total_row_count,
  })), [
    { target_node: 'source', target_port: 'data', total_row_count: 4000 },
    { target_node: 'source', target_port: 'summary', total_row_count: 1 },
  ]);
  assert.deepEqual(parsed.files, [files]);
});

test('singleton runtime states survive missing tables and later states replace earlier ones', () => {
  const parsed = JSON.parse(exportedModelToRunPayload(notebookHtml([
    { command: 'run()', results: nodeState('writer', true) },
    { command: 'run()', results: nodeState('writer', false) },
    { command: 'group_gate()', results: nodeState('group', true) },
  ])));
  assert.deepEqual(parsed.runtimeNodeStates, { writer: { disabled: false }, group: { disabled: true } });
  assert.deepEqual(parsed.outputs, []);
});

test('malformed runtime metadata preserves valid sibling state and results', () => {
  const invalid = [null, 'not JSON', [], {}, { nodeId: '', disabled: true },
    { nodeId: 'source', disabled: 'true' }, { nodeId: 'source', disabled: 1 }];
  const parsed = JSON.parse(exportedModelToRunPayload(notebookHtml([{
    command: 'display(ctx["source.data"])', results: { data: [
      nodeState('source', false),
      ...invalid.map((payload) => ({ type: 'mimeBundle', data: { [NODE_STATE_MIME_TYPE]: payload } })),
      displayTable(1, false),
    ] },
  }])));
  assert.deepEqual(parsed.runtimeNodeStates, { source: { disabled: false } });
  assert.equal(parsed.outputs[0].target_port, 'data');
});

test('runtime node names cannot modify the state map prototype', () => {
  const blocks = [{ type: 'output', id: 'data', label: 'Hidden data', nodeId: '__proto__', port: 'data' }];
  const raw = exportedModelToRunPayload(notebookHtml([{
    command: 'display(ctx["__proto__.data"])', results: { data: [nodeState('__proto__', true), displayTable(1, false)] },
  }]));
  const parsed = JSON.parse(raw);
  assert.equal(Object.hasOwn(parsed.runtimeNodeStates, '__proto__'), true);
  assert.equal(parsed.runtimeNodeStates.__proto__.disabled, true);
  const result = parseRunOutcome(matchRunOutputs(blocks, raw));
  assert.equal(result.outputs[0].disabled, true);
  assert.equal(publishedBlocksHtml(blocks, result.outputs), '');
});

const ENVIRONMENT_BLOCKS = [
  { type: 'output', id: 'prod', label: 'Prod Output', nodeId: 'prod', port: 'data' },
  { type: 'output', id: 'dev', label: 'Dev Output', nodeId: 'dev', port: 'data' },
];

function environmentResult(environment) {
  return matchedRunOutputs(ENVIRONMENT_BLOCKS, ['prod', 'dev'].map((nodeId) => ({
    command: `display(ctx["${nodeId}.data"])`,
    results: { data: [nodeState(nodeId, nodeId !== environment), displayTable(1, false)] },
  })));
}

for (const environment of ['prod', 'dev']) {
  test(`only renders the ${environment} branch recorded by the run`, () => {
    const result = environmentResult(environment);
    assert.deepEqual(result.outputs.map(({ id, disabled }) => ({ id, disabled })), [
      { id: 'prod', disabled: environment !== 'prod' }, { id: 'dev', disabled: environment !== 'dev' },
    ]);
    const html = publishedBlocksHtml(ENVIRONMENT_BLOCKS, result.outputs);
    assert.match(html, environment === 'prod' ? /Prod Output/ : /Dev Output/);
    assert.doesNotMatch(html, environment === 'prod' ? /Dev Output/ : /Prod Output/);
    assert.match(html, /<table/);
  });
}

test('disabled outputs without a preview or file receipt hide their entire block', () => {
  const blocks = [
    { type: 'markdown', id: 'intro', text: 'Download your output' },
    ...ENVIRONMENT_BLOCKS.map((block) => ({ ...block, fileOutput: { volumes: ['main.apps.files'] } })),
  ];
  const result = matchedRunOutputs(blocks, ['prod', 'dev'].map((nodeId) => ({
    command: 'run()', results: nodeState(nodeId, true),
  })));
  assert.equal(result.outcome, 'outputs');
  assert.deepEqual(result.outputs.map(({ disabled, files }) => ({ disabled, files })), [
    { disabled: true, files: [] }, { disabled: true, files: [] },
  ]);
  const html = publishedBlocksHtml(blocks, result.outputs);
  assert.match(html, /Download your output/);
  assert.equal(html, publishedBlocksHtml([blocks[0]], []));
});

test('enabled empty results, errors, malformed results, and missing outputs remain visible', () => {
  const blocks = [{ type: 'output', id: 'data', label: 'Visible Output', nodeId: 'source', port: 'data' }];
  const cases = [
    { outcome: 'result', payload: { ...outputFromTable(displayTable(0, false)), target_node: 'source', target_port: 'data' }, message: /No rows returned/ },
    { outcome: 'computeError', payload: { status: 'error', target_node: 'source', target_port: 'data', error: { type: 'BranchError', message: 'Read failed' } }, message: /Read failed/ },
    { outcome: 'malformed', payload: { id: 'data', status: 'ok' }, message: /This output could not be read/ },
    { outcome: 'missing', payload: undefined, message: /This output was not returned/ },
  ];
  for (const { outcome, payload, message } of cases) {
    const result = parseRunOutcome(matchRunOutputs(blocks, JSON.stringify({
      version: 2, outputs: payload ? [payload] : [], runtimeNodeStates: { source: { disabled: false } },
    })));
    assert.equal(result.outputs[0].disabled, false);
    assert.equal(result.outputs[0].outcome.outcome, outcome);
    const html = publishedBlocksHtml(blocks, result.outputs);
    assert.match(html, /Visible Output/);
    assert.match(html, message);
  }
});

test('absent or non-boolean state preserves output visibility on the server and client', () => {
  const blocks = [{ type: 'output', id: 'data', label: 'Legacy Output', nodeId: 'source', port: 'data' }];
  for (const disabled of [undefined, null, 'true', 'false', 0, 1, {}, []]) {
    const result = parseRunOutcome(matchRunOutputs(blocks, JSON.stringify({
      version: 2,
      outputs: [{ ...outputFromTable(displayTable(0, false)), target_node: 'source', target_port: 'data' }],
      runtimeNodeStates: { source: { disabled } },
    })));
    assert.equal(result.outputs[0].disabled, undefined);
    const client = parseRunOutcome({ ...result, outputs: [{ ...result.outputs[0], disabled }] });
    assert.equal(client.outputs[0].disabled, undefined);
    assert.match(publishedBlocksHtml(blocks, client.outputs), /Legacy Output/);
    assert.match(publishedBlocksHtml(blocks, client.outputs), /No rows returned/);
  }
});

test('initial placeholders remain visible without recorded runtime state', () => {
  const html = publishedBlocksHtml(ENVIRONMENT_BLOCKS, [], 'beforeRun');
  assert.match(html, /Prod Output/);
  assert.match(html, /Dev Output/);
  assert.equal((html.match(/Run the app to populate this output/g) ?? []).length, 2);
});

test('explicit history selection uses that run’s disablement instead of the most recent result', () => {
  const latest = { status: 'found', run: { jobRunId: '42' }, parameters: { environment: 'prod' }, result: environmentResult('prod') };
  const historical = { status: 'found', outcome: environmentResult('dev') };
  const selected = { jobRunId: '41', parameters: { environment: 'dev' } };
  const idle = { phase: 'idle' };
  const followed = { following: false, settled: false };
  const display = planRunDisplay(idle, followed, latest, selected, historical);
  assert.equal(display.displayedRun.jobRunId, '41');
  assert.match(publishedBlocksHtml(ENVIRONMENT_BLOCKS, display.outputs), /Dev Output/);
  assert.doesNotMatch(publishedBlocksHtml(ENVIRONMENT_BLOCKS, display.outputs), /Prod Output/);
  const restored = planRunDisplay(idle, followed, latest);
  assert.match(publishedBlocksHtml(ENVIRONMENT_BLOCKS, restored.outputs), /Prod Output/);
  assert.doesNotMatch(publishedBlocksHtml(ENVIRONMENT_BLOCKS, restored.outputs), /Dev Output/);
});

function outputFromTable(table) {
  const html = notebookHtml([
    { command: 'display(ctx["source_0.data"])', results: { type: 'listResults', data: [table] } },
  ]);
  return JSON.parse(exportedModelToRunPayload(html)).outputs[0];
}

test('file receipts are decoded independently of tables and full counts without shifting display ports', () => {
  const receipt = { node: 'output_0', files: [{ path: '/Volumes/main/apps/files/sheet.xlsx' }] };
  const html = notebookHtml([
    { command: 'write_output()', results: { type: 'listResults', data: [
      { type: 'mimeBundle', data: { [FILES_MIME_TYPE]: JSON.stringify(receipt) } },
    ] } },
    { command: 'display(ctx["source_0.data"])', results: { type: 'listResults', data: [
      { type: 'mimeBundle', data: { [FILES_MIME_TYPE]: { node: 'output_1', files: [] } } },
      displayTable(2, true), rowCounts('source_0', { data: 12345 }),
    ] } },
  ]);
  const parsed = JSON.parse(exportedModelToRunPayload(html));
  assert.deepEqual(parsed.files, [receipt, { node: 'output_1', files: [] }]);
  assert.equal(parsed.outputs.length, 1);
  assert.equal(parsed.outputs[0].target_node, 'source_0');
  assert.equal(parsed.outputs[0].total_row_count, 12345);
});

test('a singleton file MIME receipt remains available when no preview was produced', () => {
  const receipt = { node: 'output_0', files: [{ path: '/Volumes/main/apps/files/report.csv' }] };
  const parsed = JSON.parse(exportedModelToRunPayload(notebookHtml([{
    command: 'write_file()', results: { type: 'mimeBundle', data: { [FILES_MIME_TYPE]: receipt } },
  }])));
  assert.deepEqual(parsed.files, [receipt]);
  assert.deepEqual(parsed.outputs, []);
});

test('file MIME receipts retain their effective behavior and ignore unrecognized metadata', () => {
  for (const behavior of ['run_artifact', 'shared_append', 'shared_workbook_update', undefined, 'overwrite', null, {}]) {
    const receipt = { node: 'output_0', files: [{ path: '/Volumes/main/apps/files/report.csv' }], behavior };
    const parsed = JSON.parse(exportedModelToRunPayload(notebookHtml([{
      command: 'write_file()', results: { type: 'mimeBundle', data: { [FILES_MIME_TYPE]: receipt } },
    }])));
    assert.deepEqual(parsed.files, [{
      node: receipt.node, files: receipt.files,
      ...(['run_artifact', 'shared_append', 'shared_workbook_update'].includes(behavior) ? { behavior } : {}),
    }]);
  }
});

test('malformed file receipts do not discard valid sibling receipts or table counts', () => {
  const invalid = ['not JSON', {}, { node: 'output', files: [{}] },
    { node: 'output', files: Array.from({ length: 51 }, () => ({ path: '/Volumes/a/b/c/data.csv' })) }];
  const html = notebookHtml([{ command: 'display(ctx["source_0.data"])', results: { data: [
    ...invalid.map((receipt) => ({ type: 'mimeBundle', data: { [FILES_MIME_TYPE]: receipt } })),
    displayTable(1, false), rowCounts('source_0', { data: 1 }),
  ] } }]);
  const parsed = JSON.parse(exportedModelToRunPayload(html));
  assert.deepEqual(parsed.files, []);
  assert.equal(parsed.outputs[0].total_row_count, 1);
});

function parsePayload(payload) {
  const result = parseRunOutcome({
    outcome: 'outputs',
    outputs: [{ id: 'output', title: 'Output', outcome: { outcome: 'result', payload } }],
  });
  assert.equal(result.outcome, 'outputs');
  assert.equal(result.outputs[0].outcome.outcome, 'result');
  return result.outputs[0].outcome.payload;
}

function footer(payload) {
  return renderToStaticMarkup(createElement(ResultFooter, { payload }));
}

function outputSection(payload, chartSpec, files, fileBehavior) {
  return renderToStaticMarkup(createElement(OutputSection, {
    output: {
      key: 'output',
      title: 'Published output',
      chartSpec,
      files,
      fileBehavior,
      outcome: { outcome: 'result', payload },
    },
    onRetry: () => {},
    downloadRequest: files ? { runId: '42', outputId: 'output' } : undefined,
  }));
}

test('published blocks never render outputs outside the manifest', () => {
  const html = renderToStaticMarkup(createElement(PublishedBlocks, {
    blocks: [{ type: 'output', id: 'data', label: 'Published data', nodeId: 'source', port: 'data' }],
    outputs: [
      { key: 'declared:data', id: 'data', title: 'Published data', outcome: { outcome: 'missing', reason: 'No preview' } },
      { key: 'payload:1', id: 'extra', title: 'Unpublished result', outcome: { outcome: 'missing', reason: 'No preview' } },
    ],
    unmatchedState: 'omitted',
    onRetry: () => {},
  }));
  assert.match(html, /Published data/);
  assert.doesNotMatch(html, /Unpublished result|Returned by the run/);
});

test('tabular previews show result counts on one line without generic export controls', () => {
  const payload = parsePayload(outputFromTable(displayTable(2, false)));
  const html = outputSection(payload);
  assert.match(html, /<table/);
  assert.match(html, />2 rows</);
  assert.equal((html.match(/aria-live="polite"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Generate CSV|Generate Excel|Download|Reuses generated files/);
  const fullCount = { ...payload, total_row_count: 5000, truncated: true };
  const truncatedHtml = outputSection(fullCount);
  assert.match(truncatedHtml, /Showing 2 of 5,000 rows/);
  assert.equal((truncatedHtml.match(/aria-live="polite"/g) ?? []).length, 1);
});

test('the initial last-run response retains native file downloads without preview results', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const resultState of ['SUCCESS', 'SUCCESS_WITH_FAILURES']) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({
          status: 'found',
          run: { jobRunId: '42', resultState },
          result: { outcome: 'outputs', outputs: [{
            key: 'declared:output', id: 'output', title: 'Files', files: [{ path: '/Volumes/main/apps/files/data.xlsx' }],
            outcome: { outcome: 'missing', reason: 'No preview' },
          }] },
        }));
      const lastRun = await fetchLastRun();
      assert.equal(lastRun.status, 'found');
      const displayedRun = lastSuccessfulRunEntry(lastRun);
      assert.equal(displayedRun.jobRunId, '42');
      const html = renderToStaticMarkup(createElement(OutputSection, {
        output: lastRun.result.outputs[0], onRetry: () => {},
        downloadRequest: { runId: displayedRun.jobRunId, outputId: 'output' },
      }));
      assert.match(html, /aria-label="Download data.xlsx"/);
      assert.match(html, /\/api\/designer\/run\/42\/files\/output\/0\/download/);
      assert.match(html, /including changes made after this run/);
      assert.doesNotMatch(html, /Generated file/);
      assert.doesNotMatch(html, /No preview/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a newly failed run stays selected and never shows the previous successful outputs', () => {
  const priorOutput = { id: 'prior', title: 'Old result' };
  const lastRun = {
    status: 'found', run: { jobRunId: '41', resultState: 'SUCCESS' },
    result: { outcome: 'outputs', outputs: [priorOutput] },
  };
  const noFollowedRun = { following: false, settled: false };
  const idle = planRunDisplay({ phase: 'idle', elapsedMs: 0, cancelling: false }, noFollowedRun, lastRun);
  assert.equal(idle.displayedRun.jobRunId, '41');
  assert.deepEqual(idle.outputs, [priorOutput]);

  const running = planRunDisplay({ phase: 'running', elapsedMs: 1000, cancelling: false }, noFollowedRun, lastRun);
  assert.equal(running.unmatchedState, 'running');
  assert.deepEqual(running.outputs, []);

  const snapshot = {
    jobRunId: '42', terminal: true, resultState: 'FAILED', stateMessage: 'The Output writer failed.',
    runPageUrl: 'https://example.com/jobs/1/runs/42',
    result: { outcome: 'noPayload', reason: 'The run produced no output.' },
  };
  const failed = planRunDisplay(
    { phase: 'settled', snapshot, startedAt: 1000, elapsedMs: 2000, cancelling: false },
    noFollowedRun, lastRun,
  );
  assert.equal(failed.displayedRun.jobRunId, '42');
  assert.equal(failed.displayedRun.resultState, 'FAILED');
  assert.equal(failed.displayedRun.runPageUrl, snapshot.runPageUrl);
  assert.equal(failed.unmatchedState, 'omitted');
  assert.deepEqual(failed.outputs, []);
  const alert = renderToStaticMarkup(createElement(RunFailureAlert, { snapshot, outcome: snapshot.result }));
  assert.match(alert, /The run did not finish successfully/);
  assert.match(alert, /The Output writer failed\./);
});

test('a followed run that fails also displaces the previous successful result', () => {
  const lastRun = {
    status: 'found', run: { jobRunId: '41', resultState: 'SUCCESS' },
    result: { outcome: 'outputs', outputs: [{ id: 'prior' }] },
  };
  const snapshot = { jobRunId: '42', terminal: true, resultState: 'FAILED', stateMessage: 'Compute failed' };
  const followed = {
    following: true, settled: true, active: { run: { jobRunId: '42' } },
    snapshot, outcome: { outcome: 'noPayload', reason: 'Compute failed' },
  };
  const displayed = planRunDisplay({ phase: 'idle', elapsedMs: 0, cancelling: false }, followed, lastRun);
  assert.equal(displayed.displayedRun.jobRunId, '42');
  assert.deepEqual(displayed.outputs, []);
  assert.equal(displayed.unmatchedState, 'omitted');
  assert.equal(shouldRetainSettledFollowedRun(undefined, '42', 'idle'), true);
  assert.equal(shouldRetainSettledFollowedRun('43', '42', 'idle'), false);
  assert.equal(shouldRetainSettledFollowedRun(undefined, '42', 'running'), false);
});

test('a failed run still exposes files it finished writing', () => {
  const fileOutput = { id: 'writer', files: [{ path: '/Volumes/main/apps/files/report.xlsx' }] };
  const snapshot = {
    jobRunId: '42', terminal: true, resultState: 'FAILED', stateMessage: 'A later operator failed',
    result: { outcome: 'outputs', outputs: [fileOutput] },
  };
  const displayed = planRunDisplay(
    { phase: 'settled', snapshot, elapsedMs: 2000, cancelling: false },
    { following: false, settled: false },
    { status: 'none' },
  );
  assert.equal(displayed.displayedRun.jobRunId, '42');
  assert.deepEqual(displayed.outputs, [fileOutput]);
  const alert = renderToStaticMarkup(createElement(RunFailureAlert, { snapshot, outcome: snapshot.result }));
  assert.match(alert, /A later operator failed/);
  assert.match(alert, /Completed file writes are available below/);
});

test('historical file labels use the recorded behavior and preserve full row counts', () => {
  const payload = { ...parsePayload(outputFromTable(displayTable(2, true))), total_row_count: 5000 };
  const files = [{ path: '/Volumes/main/apps/files/report.csv' }];
  for (const [fileBehavior, label] of [
    ['run_artifact', 'Generated file'],
    ['shared_append', 'Shared file · append mode'],
    ['shared_workbook_update', 'Shared workbook · updated'],
  ]) {
    const parsed = parseRunOutcome({ outcome: 'outputs', outputs: [{
      key: 'output', title: 'Historical output', files, fileBehavior,
      outcome: { outcome: 'result', payload },
    }] });
    const output = parsed.outputs[0];
    assert.equal(output.fileBehavior, fileBehavior);
    assert.equal(output.outcome.payload.total_row_count, 5000);
    const html = outputSection(output.outcome.payload, undefined, output.files, output.fileBehavior);
    assert.ok(html.includes(label));
    assert.match(html, /Showing 2 of 5,000 rows/);
    assert.match(html, /aria-label="Download report.csv"/);
    if (fileBehavior === 'run_artifact') {
      assert.match(html, /Later App runs use separate destinations/);
      assert.doesNotMatch(html, /including changes made after this run|may differ from the file downloaded now/);
    } else {
      assert.match(html, /including changes made after this run/);
      assert.match(html, /row count are as of the selected run and may differ from the file downloaded now/);
    }
  }
});

test('legacy or unknown file behavior stays conservative even for a namespaced-looking path', () => {
  const payload = parsePayload(outputFromTable(displayTable(2, false)));
  const files = [{ path: '/Volumes/main/apps/files/_designer_apps/namespace/attempt/node/report.csv' }];
  for (const fileBehavior of [undefined, 'overwrite', 'RUN_ARTIFACT', null, {}]) {
    const parsed = parseRunOutcome({ outcome: 'outputs', outputs: [{
      key: 'output', title: 'Legacy output', files, fileBehavior,
      outcome: { outcome: 'result', payload },
    }] });
    assert.equal(parsed.outputs[0].fileBehavior, undefined);
    const html = outputSection(payload, undefined, files, parsed.outputs[0].fileBehavior);
    assert.match(html, /including changes made after this run/);
    assert.doesNotMatch(html, /Generated file|Shared file · append mode|Shared workbook · updated/);
  }
});

for (const widgetType of ['line', 'pie', 'unsupported']) {
  test(`${widgetType} visualization shows counts only for fallback tables and hides download controls`, () => {
    const chartSpec = {
      widgetType,
      encodings: {
        x: { fieldName: 'value', scale: { type: 'quantitative' } },
        y: { fieldName: 'value', scale: { type: 'quantitative' } },
        color: { fieldName: 'value', scale: { type: 'categorical' } },
        angle: { fieldName: 'value', scale: { type: 'quantitative' } },
      },
    };
    for (const rowCount of [0, 2]) {
      const payload = parsePayload(outputFromTable(displayTable(rowCount, false)));
      const html = outputSection(payload, chartSpec);
      assert.match(html, /Published output/);
      if (widgetType === 'unsupported' && rowCount > 0) {
        assert.match(html, />2 rows</);
      } else {
        assert.doesNotMatch(html, />[\d,]+ rows(?: shown)?</);
      }
      assert.doesNotMatch(html, /Generate CSV|Generate Excel|Reuses generated files/);
      if (rowCount === 0) assert.match(html, /No rows returned/);
      else if (widgetType === 'unsupported') assert.match(html, /<table/);
    }
  });
}

test('visualizations retain their truncated-data warning without the table footer or downloads', () => {
  const payload = parsePayload(outputFromTable(displayTable(2, true)));
  const html = outputSection(payload, {
    widgetType: 'line',
    encodings: {
      x: { fieldName: 'value', scale: { type: 'quantitative' } },
      y: { fieldName: 'value', scale: { type: 'quantitative' } },
    },
  });
  assert.match(html, /This chart is drawn from part of the result/);
  assert.doesNotMatch(html, />2 rows shown</);
  assert.doesNotMatch(html, /Generate CSV|Generate Excel|Reuses generated files/);
});

test('preserves notebook overflow without inventing a full count or a row-limit cause', () => {
  for (const rowCount of [0, 17, 1000, 1500]) {
    const output = outputFromTable(displayTable(rowCount, true));
    assert.equal(output.rows.length, Math.min(rowCount, 1000));
    assert.equal(output.truncated, true);
    assert.equal(output.total_row_count, undefined);
    const payload = parsePayload(output);
    assert.equal(payload.truncated, true);
    assert.equal(payload.total_row_count, undefined);
    const html = footer(payload);
    assert.match(html, /preview rows · /);
    assert.match(html, /Truncated/);
    assert.doesNotMatch(html, /Complete result|sample|byte budget| \/ /i);
  }
});

for (const rowCount of [0, 999, 1000, 1001, 1500]) {
  test(`caps a complete ${rowCount}-row export and retains its exact count`, () => {
    const output = outputFromTable(displayTable(rowCount, false));
    assert.equal(output.rows.length, Math.min(rowCount, 1000));
    assert.equal(output.truncated, rowCount > 1000);
    assert.equal(output.total_row_count, rowCount);
    const payload = parsePayload(output);
    assert.equal(payload.total_row_count, rowCount);
    assert.deepEqual(payload.rows, output.rows);
    assert.equal(payload.truncated, rowCount > 1000);
    const html = footer(payload);
    if (rowCount > 1000) {
      assert.ok(html.includes(`Showing 1,000 of ${rowCount.toLocaleString()} rows`));
      assert.doesNotMatch(html, /Truncated/);
    } else {
      assert.ok(html.includes(`${rowCount.toLocaleString()} rows`));
      assert.doesNotMatch(html, /Truncated|rows shown/);
    }
    assert.doesNotMatch(html, /Complete result/);
  });
}

test('missing or malformed overflow stays unknown even for an empty or exactly 1,000-row result', () => {
  for (const overflow of [undefined, null, 'false', 'true', 0, 1, {}]) {
    for (const rowCount of [0, 17, 1000]) {
      const payload = parsePayload(outputFromTable(displayTable(rowCount, overflow)));
      assert.equal(payload.truncated, null);
      assert.equal(payload.total_row_count, undefined);
      const html = footer(payload);
      assert.ok(html.includes(`${rowCount.toLocaleString()} returned rows`));
      assert.doesNotMatch(html, /Truncated|Complete result| \/ /);
    }
  }
});

test('the app cap proves truncation but not a total when source completeness is unknown', () => {
  const payload = parsePayload(outputFromTable(displayTable(1001)));
  assert.equal(payload.rows.length, 1000);
  assert.equal(payload.truncated, true);
  assert.equal(payload.total_row_count, undefined);
});

test('keeps overflow and counts isolated per displayed port, including encoded exports', () => {
  const html = notebookHtml([
    {
      command: 'display(ctx["filter.filtered_data"])\ndisplay(ctx["filter.excluded_data"])',
      results: { data: [displayTable(990, false), displayTable(1000, true)] },
    },
    { command: 'display(ctx["viz.data"])', results: { data: [displayTable(12, false)] } },
  ]);
  const plain = exportedModelToRunPayload(html);
  assert.equal(exportedModelToRunPayload(Buffer.from(html).toString('base64')), plain);
  assert.deepEqual(
    JSON.parse(plain).outputs.map(({ target_node, target_port, rows, truncated, total_row_count }) => ({
      target_node, target_port, rows: rows.length, truncated, total_row_count,
    })),
    [
      { target_node: 'filter', target_port: 'filtered_data', rows: 990, truncated: false, total_row_count: 990 },
      { target_node: 'filter', target_port: 'excluded_data', rows: 1000, truncated: true, total_row_count: undefined },
      { target_node: 'viz', target_port: 'data', rows: 12, truncated: false, total_row_count: 12 },
    ],
  );
});

test('invalid notebook exports remain unreadable instead of fabricating an empty complete result', () => {
  for (const html of [undefined, null, '', '<html>not a notebook</html>', "__DATABRICKS_NOTEBOOK_MODEL = 'invalid'"]) {
    assert.equal(exportedModelToRunPayload(html), undefined);
  }
});

test('client also caps oversized payloads before rendering a table or feeding a chart', () => {
  const raw = outputFromTable(displayTable(1, false));
  raw.rows = Array.from({ length: 1500 }, (_, value) => ({ value }));
  delete raw.total_row_count;
  const payload = parsePayload(raw);
  assert.equal(raw.rows.length, 1500, 'parsing must not mutate the response');
  assert.equal(payload.rows.length, 1000);
  assert.equal(payload.truncated, true);
  assert.equal(payload.total_row_count, 1500);
  assert.deepEqual(payload.rows.at(-1), { value: 999 });
  const grid = renderToStaticMarkup(createElement(ResultGrid, { payload }));
  assert.equal((grid.match(/<tr[ >]/g) ?? []).length, 1001, 'one header and every returned preview row');
  assert.match(grid, /Showing 1,000 of 1,500 rows/);
  assert.match(grid, /This preview is truncated/);
});

test('renders a separately supplied exact total without downloading those rows', () => {
  const payload = parsePayload({ ...outputFromTable(displayTable(1000, true)), total_row_count: 558837 });
  assert.equal(payload.rows.length, 1000);
  assert.equal(payload.total_row_count, 558837);
  assert.match(footer(payload), /Showing 1,000 of 558,837 rows/);
});

test('reads exact per-port totals from the runner count metadata without shifting table results', () => {
  const html = notebookHtml([
    {
      command: 'display(ctx["filter.filtered_data"])\ndisplay(ctx["filter.excluded_data"])',
      results: {
        data: [
          rowCounts('filter', { filtered_data: 558837, excluded_data: 12 }),
          displayTable(1000, true),
          displayTable(12, false),
        ],
      },
    },
  ]);

  const outputs = JSON.parse(exportedModelToRunPayload(html)).outputs;
  assert.deepEqual(
    outputs.map(({ target_port, rows, total_row_count }) => ({
      target_port,
      rows: rows.length,
      total_row_count,
    })),
    [
      { target_port: 'filtered_data', rows: 1000, total_row_count: 558837 },
      { target_port: 'excluded_data', rows: 12, total_row_count: 12 },
    ],
  );
  assert.match(footer(parsePayload(outputs[0])), /Showing 1,000 of 558,837 rows/);
});

test('ignores malformed count metadata and preserves the preview completeness signal', () => {
  for (const marker of [
    rowCounts('', { data: 50 }),
    rowCounts('source_0', {}),
    rowCounts('source_0', { data: -1 }),
    rowCounts('source_0', { data: 1.5 }),
    rowCounts('source_0', { data: '50' }),
  ]) {
    const html = notebookHtml([
      {
        command: 'display(ctx["source_0.data"])',
        results: { data: [displayTable(10, true), marker] },
      },
    ]);
    const output = JSON.parse(exportedModelToRunPayload(html)).outputs[0];
    assert.equal(output.total_row_count, undefined);
    assert.equal(output.truncated, true);
  }
});

test('rejects impossible or unsafe totals instead of labeling a truncated preview as complete', () => {
  for (const total of [-1, 0, 999, 1000, 1000.5, '558837', null, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const payload = parsePayload({ ...outputFromTable(displayTable(1000, true)), total_row_count: total });
    assert.equal(payload.total_row_count, undefined);
    assert.equal(payload.truncated, true);
    assert.match(footer(payload), /1,000 preview rows · /);
    assert.match(footer(payload), /Truncated/);
  }
});

test('an exact total larger than the returned rows proves truncation despite an inconsistent flag', () => {
  const payload = parsePayload({ ...outputFromTable(displayTable(10, false)), total_row_count: 20 });
  assert.equal(payload.truncated, true);
  assert.equal(payload.total_row_count, 20);
  assert.match(footer(payload), /Showing 10 of 20 rows/);
});

test('missing client metadata does not imply completeness or break rendering', () => {
  const raw = outputFromTable(displayTable(10, false));
  delete raw.truncated;
  delete raw.total_row_count;
  const payload = parsePayload(raw);
  assert.equal(payload.truncated, null);
  assert.equal(payload.total_row_count, undefined);
  assert.match(footer(payload), /10 returned rows/);
});
