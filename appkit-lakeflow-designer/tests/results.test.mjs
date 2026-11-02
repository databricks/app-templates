import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'tsdown';

import { parseRunOutcome } from '../server/plugins/designer/client.ts';
let parseAppManifest;
let fetchLastRun;
let lastSuccessfulRunEntry;
let planRunDisplay;
let RunFailureAlert;
let GuardrailSummary;
let shouldRetainSettledFollowedRun;
let ResultFooter;
let ResultGrid;
let OutputSection;
let PublishedBlocks;
let outputDirectory;

before(async () => {
  // Keep React and AppKit resolvable from the generated modules without copying dependencies.
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.result-tests-', import.meta.url)));
  await build({
    entry: {
      appConfig: 'client/src/appConfig.ts',
      ResultFooter: 'client/src/ResultFooter.tsx',
      ResultGrid: 'client/src/ResultGrid.tsx',
      App: 'client/src/App.tsx',
      runDisplay: 'client/src/runDisplay.ts',
      GuardrailSummary: 'client/src/GuardrailSummary.tsx',
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
  ({ parseAppManifest } = await import(pathToFileURL(join(outputDirectory, 'appConfig.mjs')).href));
  ({ ResultFooter } = await import(pathToFileURL(join(outputDirectory, 'ResultFooter.mjs')).href));
  ({ ResultGrid } = await import(pathToFileURL(join(outputDirectory, 'ResultGrid.mjs')).href));
  ({ OutputSection, PublishedBlocks, RunFailureAlert } = await import(
    pathToFileURL(join(outputDirectory, 'App.mjs')).href
  ));
  ({ lastSuccessfulRunEntry, planRunDisplay } = await import(
    pathToFileURL(join(outputDirectory, 'runDisplay.mjs')).href
  ));
  ({ fetchLastRun } = await import(pathToFileURL(join(outputDirectory, 'lastRun.mjs')).href));
  ({ GuardrailSummary } = await import(pathToFileURL(join(outputDirectory, 'GuardrailSummary.mjs')).href));
  ({ shouldRetainSettledFollowedRun } = await import(pathToFileURL(join(outputDirectory, 'landingPlan.mjs')).href));
});

after(async () => {
  if (outputDirectory !== undefined) await rm(outputDirectory, { recursive: true });
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
  return renderToStaticMarkup(
    createElement(OutputSection, {
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
    })
  );
}

function publishedBlocksHtml(blocks, outputs, unmatchedState = 'omitted') {
  return renderToStaticMarkup(
    createElement(PublishedBlocks, {
      blocks,
      outputs,
      unmatchedState,
      downloadRunId: '42',
      onRetry: () => {},
    })
  );
}

const ENVIRONMENT_BLOCKS = [
  { type: 'output', id: 'prod', label: 'Prod Output', nodeId: 'prod', port: 'data' },
  { type: 'output', id: 'dev', label: 'Dev Output', nodeId: 'dev', port: 'data' },
];

const HTML_BLOCK = { type: 'output', id: 'page', nodeId: 'html_1', kind: 'html', label: 'Report' };

// API-shaped input keeps rendering tests independent of notebook export decoding.
function preview(rowCount, truncated) {
  return {
    status: 'ok',
    target_node: 'source',
    target_port: 'data',
    schema: [{ name: 'value', type: 'long', nullable: true }],
    rows: Array.from({ length: rowCount }, (_, value) => ({ value })),
    truncated,
  };
}

for (const environment of ['prod', 'dev']) {
  test(`renders only the ${environment} branch from the plugin response`, () => {
    const result = parseRunOutcome({
      outcome: 'outputs',
      outputs: ENVIRONMENT_BLOCKS.map((block) => ({
        key: `declared:${block.id}`,
        id: block.id,
        title: block.label,
        disabled: block.id !== environment,
        outcome: { outcome: 'result', payload: preview(1, false) },
      })),
    });
    const html = publishedBlocksHtml(ENVIRONMENT_BLOCKS, result.outputs);
    assert.match(html, environment === 'prod' ? /Prod Output/ : /Dev Output/);
    assert.doesNotMatch(html, environment === 'prod' ? /Dev Output/ : /Prod Output/);
    assert.match(html, /<table/);
  });
}

for (const outcome of [
  {
    outcome: 'result',
    payload: {
      status: 'ok',
      target_node: 'source',
      target_port: 'data',
      schema: [{ name: 'value', type: 'long' }],
      rows: [],
      truncated: false,
    },
  },
  { outcome: 'html', html: '<h1>Report</h1>' },
  { outcome: 'missing', reason: 'No preview' },
  {
    outcome: 'computeError',
    payload: { status: 'error', target_node: 'source', error: { type: 'InputError', message: 'Input unavailable' } },
  },
]) {
  test(`recorded disablement hides the whole ${outcome.outcome} output`, () => {
    const block =
      outcome.outcome === 'html'
        ? { ...HTML_BLOCK, id: 'prod', label: 'Prod Output' }
        : { ...ENVIRONMENT_BLOCKS[0], fileOutput: { volumes: ['main.apps.files'] } };
    const output = {
      key: 'declared:prod',
      id: 'prod',
      title: block.label,
      files: [{ path: '/Volumes/main/apps/files/report.csv' }],
      outcome,
    };
    for (const disabled of [false, undefined, 'true']) {
      const result = parseRunOutcome({ outcome: 'outputs', outputs: [{ ...output, disabled }] });
      const html = publishedBlocksHtml([block], result.outputs);
      assert.match(html, /Prod Output/);
      assert.match(html, outcome.outcome === 'html' ? /<iframe/ : /Download report.csv/);
    }
    const disabled = parseRunOutcome({ outcome: 'outputs', outputs: [{ ...output, disabled: true }] });
    assert.equal(publishedBlocksHtml([block], disabled.outputs), '');
  });
}

test('renders HTML from the plugin response in the sandbox wrapper', () => {
  const result = parseRunOutcome({
    outcome: 'outputs',
    outputs: [
      {
        key: 'declared:page',
        id: 'page',
        title: 'Report',
        outcome: { outcome: 'html', html: '<h1>Sales report</h1>' },
      },
    ],
  });
  assert.equal(result.outputs[0].outcome.outcome, 'html');
  const html = renderToStaticMarkup(createElement(OutputSection, { output: result.outputs[0], onRetry() {} }));
  assert.match(html, /title="Report"/);
  assert.match(html, /frame-src &#x27;none&#x27;/);
  assert.doesNotMatch(html, /Sales report|allow-same-origin/);
});

test('diagnostic text is escaped and invalid diagnostic fields do not discard valid results', () => {
  const result = parseRunOutcome({
    outcome: 'noPayload',
    reason: 'No tables',
    diagnostics: [
      {
        operatorName: '<script>name</script>',
        checkIndex: 0,
        severity: 'warning',
        message: '<img src=x onerror=alert(1)>',
      },
      null,
      {},
      { operatorName: 'Bad', checkIndex: -1, severity: 'warning', message: 'bad index' },
      { operatorName: 'Bad', checkIndex: 1, severity: 'success', message: 'bad severity' },
    ],
  });
  assert.equal(result.diagnostics.length, 1);
  const html = renderToStaticMarkup(createElement(GuardrailSummary, result));
  assert.match(html, /&lt;script&gt;name&lt;\/script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img/);
});

test('failed run displays the actual task error ahead of the generic Job status', () => {
  const html = renderToStaticMarkup(
    createElement(RunFailureAlert, {
      snapshot: {
        jobRunId: '42',
        terminal: true,
        resultState: 'FAILED',
        stateMessage: 'Task compute_operator failed.',
      },
      outcome: {
        outcome: 'noPayload',
        reason: 'No tables',
        failureReason: 'ValueError: Guardrails failed the workflow.',
      },
    })
  );
  assert.match(html, /ValueError: Guardrails failed the workflow/);
  assert.doesNotMatch(html, /Task compute_operator failed/);
});

test('initial placeholders remain visible without recorded runtime state', () => {
  const html = publishedBlocksHtml(ENVIRONMENT_BLOCKS, [], 'beforeRun');
  assert.match(html, /Prod Output/);
  assert.match(html, /Dev Output/);
  assert.equal((html.match(/Run the app to populate this output/g) ?? []).length, 2);
});

test('optional visibility preferences preserve booleans and safely ignore other values', () => {
  const base = { version: 8, appName: 'Branch outputs', blocks: ENVIRONMENT_BLOCKS, parameters: [] };
  for (const value of [true, false]) {
    const parsed = parseAppManifest({
      ...base,
      blocks: base.blocks.map((block) => ({ ...block, hideUntilResults: value })),
    });
    assert.equal(parsed.blocks[0].hideUntilResults, value);
    assert.equal(parsed.blocks[1].hideUntilResults, value);
  }
  for (const value of [undefined, null, 'true', 'false', 0, 1, {}, []]) {
    const parsed = parseAppManifest({
      ...base,
      blocks: base.blocks.map((block) => ({ ...block, hideUntilResults: value })),
    });
    assert.equal(parsed.blocks[0].hideUntilResults, undefined);
    assert.equal(parsed.blocks[1].hideUntilResults, undefined);
    assert.match(publishedBlocksHtml(parsed.blocks, [], 'beforeRun'), /Prod Output/);
  }
});

test('legacy app-wide visibility does not hide blocks without their own preference', () => {
  const parsed = parseAppManifest({
    version: 8,
    appName: 'Branch outputs',
    blocks: ENVIRONMENT_BLOCKS,
    parameters: [],
    hideOutputsUntilResults: true,
  });
  assert.equal(Object.hasOwn(parsed, 'hideOutputsUntilResults'), false);
  assert.match(publishedBlocksHtml(parsed.blocks, [], 'beforeRun'), /Prod Output/);
  assert.match(publishedBlocksHtml(parsed.blocks, [], 'beforeRun'), /Dev Output/);
});

test('per-block preferences control output and Markdown visibility in all pending states', () => {
  const blocks = [
    { type: 'markdown', id: 'intro', text: 'Choose an environment.' },
    { type: 'markdown', id: 'shown-text', text: 'Always visible text.', hideUntilResults: false },
    { type: 'markdown', id: 'hidden-text', text: 'Result explanation.', hideUntilResults: true },
    { type: 'output', id: 'default', label: 'Default output', nodeId: 'source', port: 'data' },
    {
      type: 'output',
      id: 'show',
      label: 'Visible placeholder',
      nodeId: 'shown',
      port: 'data',
      hideUntilResults: false,
    },
    { type: 'output', id: 'hide', label: 'Hidden placeholder', nodeId: 'hidden', port: 'data', hideUntilResults: true },
  ];
  for (const state of ['beforeRun', 'running', 'loading']) {
    const html = publishedBlocksHtml(blocks, [], state);
    assert.match(html, /Choose an environment\./);
    assert.match(html, /Always visible text\./);
    assert.match(html, /Default output/);
    assert.match(html, /Visible placeholder/);
    assert.doesNotMatch(html, /Result explanation\.|Hidden placeholder/);
  }
  assert.match(publishedBlocksHtml(blocks, [], 'omitted'), /Result explanation\./);
});

test('hiding every pending output removes its headings, placeholders, and surrounding card', () => {
  const blocks = ENVIRONMENT_BLOCKS.filter((block) => block.type === 'output').map((block) => ({
    ...block,
    hideUntilResults: true,
  }));
  for (const state of ['beforeRun', 'running', 'loading']) {
    assert.equal(publishedBlocksHtml(blocks, [], state), '');
  }
  const finished = publishedBlocksHtml(blocks, [], 'omitted');
  assert.match(finished, /Prod Output/);
  assert.match(finished, /Dev Output/);
  assert.match(finished, /The run finished without returning a result/);
});

test('hidden Markdown appears after completed empty results and errors, including disabled outputs', () => {
  const blocks = [
    { type: 'markdown', id: 'explanation', text: 'Completed run explanation.', hideUntilResults: true },
    { type: 'output', id: 'data', label: 'Data output', nodeId: 'source', port: 'data', hideUntilResults: true },
  ];
  for (const state of ['beforeRun', 'running', 'loading']) {
    assert.equal(publishedBlocksHtml(blocks, [], state), '');
  }
  const outcomes = [
    { outcome: 'result', payload: preview(0, false) },
    {
      outcome: 'computeError',
      payload: { status: 'error', target_node: 'source', error: { type: 'ReadError', message: 'Read failed' } },
    },
  ];
  for (const outcome of outcomes) {
    const output = { key: 'declared:data', id: 'data', title: 'Data output', outcome };
    assert.match(publishedBlocksHtml(blocks, [output], 'omitted'), /Completed run explanation\./);
    const disabledHtml = publishedBlocksHtml(blocks, [{ ...output, disabled: true }], 'omitted');
    assert.match(disabledHtml, /Completed run explanation\./);
    assert.doesNotMatch(disabledHtml, /Data output/);
  }
  assert.match(publishedBlocksHtml(blocks, [], 'omitted'), /Completed run explanation\./);
});

test('available empty results and errors stay visible with hiding enabled, while disabled outputs do not', () => {
  const block = {
    type: 'output',
    id: 'data',
    label: 'Returned output',
    nodeId: 'source',
    port: 'data',
    hideUntilResults: true,
  };
  const outcomes = [
    { outcome: 'result', payload: preview(0, false) },
    {
      outcome: 'computeError',
      payload: { status: 'error', target_node: 'source', error: { type: 'ReadError', message: 'Read failed' } },
    },
    { outcome: 'missing', reason: 'The output was not returned.' },
    { outcome: 'malformed', reason: 'The output was unreadable.' },
  ];
  for (const outcome of outcomes) {
    const output = { key: 'declared:data', id: 'data', title: 'Returned output', outcome };
    const html = publishedBlocksHtml([block], [output], 'omitted');
    assert.match(html, /Returned output/);
    assert.match(html, /No rows returned|Read failed|The output was not returned|The output was unreadable/);
    for (const hideUntilResults of [undefined, false, true]) {
      assert.equal(
        publishedBlocksHtml([{ ...block, hideUntilResults }], [{ ...output, disabled: true }], 'omitted'),
        ''
      );
    }
  }
});

test('file-only outcomes remain downloadable when output placeholders are hidden', () => {
  const block = {
    type: 'output',
    id: 'file',
    label: 'Generated report',
    nodeId: 'writer',
    port: 'data',
    hideUntilResults: true,
    fileOutput: { volumes: ['main.apps.files'] },
  };
  const output = {
    key: 'declared:file',
    id: 'file',
    title: 'Generated report',
    files: [{ path: '/Volumes/main/apps/files/report.csv' }],
    outcome: { outcome: 'missing', reason: 'No table preview' },
  };
  const html = publishedBlocksHtml([block], [output], 'omitted');
  assert.match(html, /Generated report/);
  assert.match(html, /\/api\/designer\/run\/42\/files\/file\/0\/download/);
  assert.doesNotMatch(html, /No table preview/);
});

test('published blocks never render outputs outside the manifest', () => {
  const html = renderToStaticMarkup(
    createElement(PublishedBlocks, {
      blocks: [{ type: 'output', id: 'data', label: 'Published data', nodeId: 'source', port: 'data' }],
      outputs: [
        {
          key: 'declared:data',
          id: 'data',
          title: 'Published data',
          outcome: { outcome: 'missing', reason: 'No preview' },
        },
        {
          key: 'payload:1',
          id: 'extra',
          title: 'Unpublished result',
          outcome: { outcome: 'missing', reason: 'No preview' },
        },
      ],
      unmatchedState: 'omitted',
      onRetry: () => {},
    })
  );
  assert.match(html, /Published data/);
  assert.doesNotMatch(html, /Unpublished result|Returned by the run/);
});

test('tabular previews show result counts on one line without generic export controls', () => {
  const payload = parsePayload(preview(2, false));
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
        new Response(
          JSON.stringify({
            status: 'found',
            run: { jobRunId: '42', resultState },
            result: {
              outcome: 'outputs',
              outputs: [
                {
                  key: 'declared:output',
                  id: 'output',
                  title: 'Files',
                  files: [{ path: '/Volumes/main/apps/files/data.xlsx' }],
                  outcome: { outcome: 'missing', reason: 'No preview' },
                },
              ],
            },
          })
        );
      const lastRun = await fetchLastRun();
      assert.equal(lastRun.status, 'found');
      const displayedRun = lastSuccessfulRunEntry(lastRun);
      assert.equal(displayedRun.jobRunId, '42');
      const html = renderToStaticMarkup(
        createElement(OutputSection, {
          output: lastRun.result.outputs[0],
          onRetry: () => {},
          downloadRequest: { runId: displayedRun.jobRunId, outputId: 'output' },
        })
      );
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
    status: 'found',
    run: { jobRunId: '41', resultState: 'SUCCESS' },
    result: { outcome: 'outputs', outputs: [priorOutput] },
  };
  const noFollowedRun = { following: false, settled: false };
  const idle = planRunDisplay({ phase: 'idle', elapsedMs: 0, cancelling: false }, noFollowedRun, lastRun);
  assert.equal(idle.displayedRun.jobRunId, '41');
  assert.deepEqual(idle.outputs, [priorOutput]);

  const running = planRunDisplay({ phase: 'running', elapsedMs: 1000, cancelling: false }, noFollowedRun, lastRun);
  assert.equal(running.displayedRun.jobRunId, '41');
  assert.equal(running.unmatchedState, 'omitted');
  assert.equal(running.showPreviousRunLabel, true);
  assert.deepEqual(running.outputs, [priorOutput]);

  const snapshot = {
    jobRunId: '42',
    terminal: true,
    resultState: 'FAILED',
    stateMessage: 'The Output writer failed.',
    runPageUrl: 'https://example.com/jobs/1/runs/42',
    result: { outcome: 'noPayload', reason: 'The run produced no output.' },
  };
  const failed = planRunDisplay(
    { phase: 'settled', snapshot, startedAt: 1000, elapsedMs: 2000, cancelling: false },
    noFollowedRun,
    lastRun
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

test('a rerun retains the displayed historical outcome and download run until a new outcome settles', () => {
  const block = {
    type: 'output',
    id: 'report',
    label: 'Previous report',
    nodeId: 'writer',
    port: 'data',
    fileOutput: { volumes: ['main.apps.files'] },
    hideUntilResults: true,
  };
  const output = {
    key: 'declared:report',
    id: 'report',
    title: 'Previous report',
    files: [{ path: '/Volumes/main/apps/files/report.csv' }],
    outcome: { outcome: 'missing', reason: 'No preview' },
  };
  const entry = { jobRunId: '17', resultState: 'SUCCESS', parameters: { environment: 'dev' } };
  const lastRun = {
    status: 'found',
    run: { jobRunId: '41', resultState: 'SUCCESS' },
    result: { outcome: 'outputs', outputs: [] },
  };
  const followed = { following: false, settled: false };
  const retained = planRunDisplay({ phase: 'idle', elapsedMs: 0, cancelling: false }, followed, lastRun, entry, {
    status: 'found',
    outcome: { outcome: 'outputs', outputs: [output] },
  });
  const running = planRunDisplay(
    { phase: 'running', elapsedMs: 1000, cancelling: false, snapshot: { jobRunId: '42', terminal: false } },
    followed,
    lastRun,
    undefined,
    undefined,
    retained
  );
  assert.equal(running.displayedRun.jobRunId, '17');
  assert.equal(running.showPreviousRunLabel, true);
  assert.deepEqual(running.displayedRun.parameters, { environment: 'dev' });
  const html = renderToStaticMarkup(
    createElement(PublishedBlocks, {
      blocks: [
        { type: 'markdown', id: 'explanation', text: 'Previous run explanation.', hideUntilResults: true },
        block,
      ],
      outputs: running.outputs,
      unmatchedState: running.unmatchedState,
      downloadRunId: running.displayedRun.jobRunId,
      onRetry: () => {},
    })
  );
  assert.match(html, /Previous run explanation\./);
  assert.match(html, /\/api\/designer\/run\/17\/files\/report\/0\/download/);
  assert.doesNotMatch(html, /\/run\/42\//);
  const failed = planRunDisplay(
    {
      phase: 'settled',
      elapsedMs: 1000,
      cancelling: false,
      snapshot: { jobRunId: '42', terminal: true, resultState: 'FAILED' },
    },
    followed,
    lastRun,
    undefined,
    undefined,
    retained
  );
  assert.equal(failed.displayedRun.jobRunId, '42');
  assert.equal(failed.showPreviousRunLabel, undefined);
  assert.deepEqual(failed.outputs, []);
});

test('a rerun retains its submitted parameters when the previous snapshot does not record them', () => {
  const followed = { following: false, settled: false };
  const lastRun = { status: 'none' };
  const previous = {
    phase: 'settled',
    elapsedMs: 1000,
    cancelling: false,
    params: { environment: 'dev' },
    snapshot: { jobRunId: '17', terminal: true, resultState: 'SUCCESS' },
  };
  const retained = planRunDisplay(previous, followed, lastRun);
  assert.deepEqual(retained.displayedRun.parameters, { environment: 'dev' });
  const running = planRunDisplay(
    { phase: 'running', elapsedMs: 0, cancelling: false, params: { environment: 'prod' } },
    followed,
    lastRun,
    undefined,
    undefined,
    retained
  );
  assert.equal(running.displayedRun.jobRunId, '17');
  assert.deepEqual(running.displayedRun.parameters, { environment: 'dev' });
  const recorded = planRunDisplay(
    {
      ...previous,
      snapshot: { ...previous.snapshot, parameters: { environment: 'recorded' } },
    },
    followed,
    lastRun
  );
  assert.deepEqual(recorded.displayedRun.parameters, { environment: 'recorded' });
});

test('a failed submission keeps the previous display and a first run has no retained result', () => {
  const followed = { following: false, settled: false };
  const lastRun = { status: 'none' };
  const pending = planRunDisplay({ phase: 'running', elapsedMs: 1000, cancelling: false }, followed, lastRun);
  assert.equal(pending.displayedRun, undefined);
  assert.equal(pending.unmatchedState, 'running');
  const retained = { displayedRun: { jobRunId: '17' }, outputs: [], unmatchedState: 'omitted' };
  const refused = planRunDisplay(
    { phase: 'settled', elapsedMs: 1000, cancelling: false, requestError: 'Could not start the job' },
    followed,
    lastRun,
    undefined,
    undefined,
    retained
  );
  assert.deepEqual(refused, { ...retained, showPreviousRunLabel: true });
});

test('a failed submission labels the retained historical run even after a newer last run loads', () => {
  const followed = { following: false, settled: false };
  const selected = { jobRunId: '17', parameters: { environment: 'dev' }, resultState: 'SUCCESS' };
  const historicalOutput = {
    key: 'declared:data',
    id: 'data',
    title: 'Historical output',
    outcome: { outcome: 'missing', reason: 'No preview' },
  };
  const initialLastRun = { status: 'none' };
  const retained = planRunDisplay(
    { phase: 'idle', elapsedMs: 0, cancelling: false },
    followed,
    initialLastRun,
    selected,
    { status: 'found', outcome: { outcome: 'outputs', outputs: [historicalOutput] } }
  );
  const newerLastRun = {
    status: 'found',
    run: { jobRunId: '41', resultState: 'SUCCESS' },
    parameters: { environment: 'prod' },
    result: { outcome: 'outputs', outputs: [] },
  };
  const display = planRunDisplay(
    { phase: 'settled', elapsedMs: 1000, cancelling: false, requestError: 'Could not start the job' },
    followed,
    newerLastRun,
    undefined,
    undefined,
    retained
  );
  assert.deepEqual(display.displayedRun, selected);
  assert.deepEqual(display.outputs, [historicalOutput]);
  assert.equal(display.showPreviousRunLabel, true);
});

test('a followed run that fails also displaces the previous successful result', () => {
  const lastRun = {
    status: 'found',
    run: { jobRunId: '41', resultState: 'SUCCESS' },
    result: { outcome: 'outputs', outputs: [{ id: 'prior' }] },
  };
  const snapshot = { jobRunId: '42', terminal: true, resultState: 'FAILED', stateMessage: 'Compute failed' };
  const followed = {
    following: true,
    settled: true,
    active: { run: { jobRunId: '42' } },
    snapshot,
    outcome: { outcome: 'noPayload', reason: 'Compute failed' },
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
    jobRunId: '42',
    terminal: true,
    resultState: 'FAILED',
    stateMessage: 'A later operator failed',
    result: { outcome: 'outputs', outputs: [fileOutput] },
  };
  const displayed = planRunDisplay(
    { phase: 'settled', snapshot, elapsedMs: 2000, cancelling: false },
    { following: false, settled: false },
    { status: 'none' }
  );
  assert.equal(displayed.displayedRun.jobRunId, '42');
  assert.deepEqual(displayed.outputs, [fileOutput]);
  const alert = renderToStaticMarkup(createElement(RunFailureAlert, { snapshot, outcome: snapshot.result }));
  assert.match(alert, /A later operator failed/);
  assert.match(alert, /Completed file writes are available below/);
});

test('historical file labels use the recorded behavior and preserve full row counts', () => {
  const payload = { ...parsePayload(preview(2, true)), total_row_count: 5000 };
  const files = [{ path: '/Volumes/main/apps/files/report.csv' }];
  for (const [fileBehavior, label] of [
    ['run_artifact', 'Generated file'],
    ['shared_append', 'Shared file · append mode'],
    ['shared_workbook_update', 'Shared workbook · updated'],
  ]) {
    const parsed = parseRunOutcome({
      outcome: 'outputs',
      outputs: [
        {
          key: 'output',
          title: 'Historical output',
          files,
          fileBehavior,
          outcome: { outcome: 'result', payload },
        },
      ],
    });
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
  const payload = parsePayload(preview(2, false));
  const files = [{ path: '/Volumes/main/apps/files/_designer_apps/namespace/attempt/node/report.csv' }];
  for (const fileBehavior of [undefined, 'overwrite', 'RUN_ARTIFACT', null, {}]) {
    const parsed = parseRunOutcome({
      outcome: 'outputs',
      outputs: [
        {
          key: 'output',
          title: 'Legacy output',
          files,
          fileBehavior,
          outcome: { outcome: 'result', payload },
        },
      ],
    });
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
      const payload = parsePayload(preview(rowCount, false));
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
  const payload = parsePayload(preview(2, true));
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
    const output = parsePayload(preview(rowCount, true));
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
    const output = parsePayload(preview(rowCount, false));
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
      const payload = parsePayload(preview(rowCount, overflow));
      assert.equal(payload.truncated, null);
      assert.equal(payload.total_row_count, undefined);
      const html = footer(payload);
      assert.ok(html.includes(`${rowCount.toLocaleString()} returned rows`));
      assert.doesNotMatch(html, /Truncated|Complete result| \/ /);
    }
  }
});

test('the app cap proves truncation but not a total when source completeness is unknown', () => {
  const payload = parsePayload(preview(1001));
  assert.equal(payload.rows.length, 1000);
  assert.equal(payload.truncated, true);
  assert.equal(payload.total_row_count, undefined);
});

test('client also caps oversized payloads before rendering a table or feeding a chart', () => {
  const raw = preview(1, false);
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
  const payload = parsePayload({ ...preview(1000, true), total_row_count: 558837 });
  assert.equal(payload.rows.length, 1000);
  assert.equal(payload.total_row_count, 558837);
  assert.match(footer(payload), /Showing 1,000 of 558,837 rows/);
});

test('rejects impossible or unsafe totals instead of labeling a truncated preview as complete', () => {
  for (const total of [-1, 0, 999, 1000, 1000.5, '558837', null, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const payload = parsePayload({ ...preview(1000, true), total_row_count: total });
    assert.equal(payload.total_row_count, undefined);
    assert.equal(payload.truncated, true);
    assert.match(footer(payload), /1,000 preview rows · /);
    assert.match(footer(payload), /Truncated/);
  }
});

test('an exact total larger than the returned rows proves truncation despite an inconsistent flag', () => {
  const payload = parsePayload({ ...preview(10, false), total_row_count: 20 });
  assert.equal(payload.truncated, true);
  assert.equal(payload.total_row_count, 20);
  assert.match(footer(payload), /Showing 10 of 20 rows/);
});

test('missing client metadata does not imply completeness or break rendering', () => {
  const raw = preview(10, false);
  delete raw.truncated;
  delete raw.total_row_count;
  const payload = parsePayload(raw);
  assert.equal(payload.truncated, null);
  assert.equal(payload.total_row_count, undefined);
  assert.match(footer(payload), /10 returned rows/);
});
