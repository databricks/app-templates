import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import express from 'express';
import { build } from 'tsdown';

let outputDirectory, registerOutputFileRoutes, manifestRevision, recordedFileOutput;
before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.output-file-tests-', import.meta.url)));
  await build({
    entry: { outputFiles: 'server/outputFiles.ts', runRevision: 'server/runRevision.ts' },
    config: false, tsconfig: 'tsconfig.server.json', outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }), logLevel: 'silent',
  });
  ({ registerOutputFileRoutes, recordedFileOutput } = await import(pathToFileURL(join(outputDirectory, 'outputFiles.mjs')).href));
  ({ manifestRevision } = await import(pathToFileURL(join(outputDirectory, 'runRevision.mjs')).href));
});
after(async () => { if (outputDirectory) await rm(outputDirectory, { recursive: true }); });

async function harness(t) {
  const manifest = {
    version: 6, appName: 'Output app', parameters: [{ name: 'filename' }],
    blocks: [
      { type: 'output', id: 'out', nodeId: 'output_0', port: 'result', fileOutput: { volumes: ['main.apps.files', 'main.apps.other'] } },
      { type: 'output', id: 'preview', nodeId: 'source', port: 'data' },
    ],
  };
  const viewer = 'a'.repeat(64);
  const notebookPath = '/Users/author/app/runner-hash.designer.py';
  const state = {
    manifest, notebookPath, reports: [], reads: [],
    receipts: [{ node: 'output_0', files: [{ path: '/Volumes/main/apps/files/report.csv' }] }],
    run: {
      run_id: 1, job_id: 10, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' },
      tasks: [{ run_id: 2, notebook_task: { notebook_path: notebookPath } }],
      job_parameters: Object.entries({
        _lb_app_viewer: viewer,
        _lb_app_revision: manifestRevision(manifest),
        _lb_file_outputs: JSON.stringify({ output_0: manifest.blocks[0].fileOutput }),
      }).map(([name, value]) => ({ name, value })),
    },
  };
  const files = new Map([['/Volumes/main/apps/files/report.csv', Buffer.from('price\n42\n')]]);
  const app = express();
  registerOutputFileRoutes(app, {
    jobId: '10', manifest: async () => state.manifest, viewer: (req) => req.get('x-viewer'),
    notebookPath: async () => state.notebookPath, getRun: async (id) => id === 1 ? state.run : undefined,
    readPayload: async (taskId) => {
      assert.equal(taskId, '2');
      return JSON.stringify({ outputs: [], files: state.receipts });
    },
    store: (volume) => ({
      size: async (path) => files.get(path)?.length,
      download: async (path) => {
        state.reads.push({ volume, path });
        return state.stream ? state.stream() : new ReadableStream({
          start(controller) { controller.enqueue(files.get(path)); controller.close(); },
        });
      },
    }),
    report: (error) => state.reports.push(error),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const call = (path = '/1/files/out/0/download', options = {}) => fetch(
    `http://127.0.0.1:${server.address().port}/api/designer/run${path}`,
    { ...options, headers: { 'x-viewer': viewer, ...options.headers } },
  );
  return { state, files, call };
}

test('downloads original bytes repeatedly without another Job, file copy or deletion', async (t) => {
  const h = await harness(t);
  for (let index = 0; index < 3; index += 1) {
    const response = await h.call();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-disposition'), /attachment; filename="report.csv"/);
    assert.equal(await response.text(), 'price\n42\n');
  }
  assert.equal(h.files.size, 1);
  assert.equal(h.state.reads.length, 3);
});

test('downloads the recorded split-file index from any author-approved volume', async (t) => {
  const h = await harness(t);
  const path = '/Volumes/main/apps/other/sub/データ #100%.xlsx';
  h.state.receipts[0].files.push({ path });
  h.files.set(path, Buffer.from([0, 255, 1, 2]));
  const response = await h.call('/1/files/out/1/download?path=/Volumes/main/apps/files/stolen.csv');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''%E3/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 255, 1, 2]));
  assert.deepEqual(h.state.reads, [{ volume: 'main.apps.other', path }]);
});

test('serves current destination bytes and retains files when another run overwrites them', async (t) => {
  const h = await harness(t);
  h.files.set('/Volumes/main/apps/files/report.csv', Buffer.from('updated\n'));
  assert.equal(await (await h.call()).text(), 'updated\n');
  assert.equal(h.files.size, 1);
});

test('completed write receipts survive later preview/count errors and failed sibling branches', async (t) => {
  const h = await harness(t);
  h.state.run.state.result_state = 'FAILED';
  assert.equal((await h.call()).status, 200);
  delete h.state.run.state.result_state;
  h.state.run.state.life_cycle_state = 'RUNNING';
  assert.equal((await h.call()).status, 409);
});

test('presentation-only changes preserve downloads while execution changes require a new run', async (t) => {
  const h = await harness(t);
  h.state.manifest = { ...h.state.manifest, appName: 'Renamed', provenance: { publishedAt: 5000 },
    parameters: [{ name: 'filename', defaultValue: 'changed' }],
    blocks: h.state.manifest.blocks.toReversed().map((block) => ({ ...block, label: 'Changed' })) };
  assert.equal((await h.call()).status, 200);
  h.state.manifest.blocks.find((block) => block.id === 'out').fileOutput.volumes.push('main.apps.new');
  assert.equal((await h.call()).status, 409);
});

function setRunParameter(run, name, value) {
  run.job_parameters = run.job_parameters.filter((parameter) => parameter.name !== name);
  if (value !== undefined) run.job_parameters.push({ name, value });
}

for (const [label, mutate, status] of [
  ['wrong job', (h) => { h.state.run.job_id = 11; }, 404],
  ['wrong owner', (h) => { setRunParameter(h.state.run, '_lb_app_viewer', 'other'); }, 404],
  ['missing owner', (h) => { delete h.state.run.job_parameters; }, 404],
  ['legacy export run', (h) => { setRunParameter(h.state.run, '_lb_export_request', '{}'); }, 404],
  ['missing revision', (h) => { setRunParameter(h.state.run, '_lb_app_revision', undefined); }, 409],
  ['changed runner', (h) => { h.state.notebookPath += '-new'; }, 409],
  ['missing run policy', (h) => { setRunParameter(h.state.run, '_lb_file_outputs', undefined); }, 409],
  ['changed run policy', (h) => { setRunParameter(h.state.run, '_lb_file_outputs', JSON.stringify({ output_0: { volumes: ['main.apps.other'] } })); }, 409],
  ['missing artifact', (h) => { h.files.clear(); }, 404],
  ['missing receipt', (h) => { h.state.receipts = []; }, 404],
  ['duplicate receipt', (h) => { h.state.receipts.push(h.state.receipts[0]); }, 404],
  ['another node receipt', (h) => { h.state.receipts[0].node = 'source'; }, 404],
]) {
  test(`rejects ${label} before reading any file`, async (t) => {
    const h = await harness(t); mutate(h);
    assert.equal((await h.call()).status, status);
    assert.deepEqual(h.state.reads, []);
  });
}

for (const path of [
  '/Volumes/main/apps/files_other/report.csv', '/Volumes/main/apps/secret/report.csv',
  '/Volumes/main/apps/files/../secret/report.csv', '/Volumes/main/apps/files/a/./report.csv',
  '/Volumes/main/apps/files//report.csv', '/Volumes/main/apps/files/back\\slash.csv',
  '/Volumes/main/apps/files/bad\nname.csv', '/Volumes/main/apps/files/private.py',
  's3://bucket/report.csv', '/Volumes/main/apps/files/report.xlsx/',
]) {
  test(`rejects unsafe or undeclared artifact path ${JSON.stringify(path)}`, async (t) => {
    const h = await harness(t); h.state.receipts[0].files[0].path = path;
    assert.equal((await h.call()).status, 404);
    assert.deepEqual(h.state.reads, []);
  });
}

test('rejects anonymous, preview-only, invalid index and partial download requests', async (t) => {
  const h = await harness(t);
  assert.equal((await h.call(undefined, { headers: { 'x-viewer': '' } })).status, 401);
  for (const path of ['/1/files/preview/0/download', '/1/files/out/-1/download', '/1/files/out/00/download', '/2/files/out/0/download'])
    assert.equal((await h.call(path)).status, 404);
  assert.equal((await h.call(undefined, { method: 'HEAD' })).status, 405);
  assert.equal((await h.call(undefined, { headers: { range: 'bytes=0-3' } })).status, 416);
  assert.deepEqual(h.state.reads, []);
});

test('rejects duplicate or too many files as an entire invalid receipt', () => {
  for (const files of [[{ path: '/Volumes/main/apps/files/a.csv' }, { path: '/Volumes/main/apps/files/a.csv' }],
    Array.from({ length: 51 }, (_, index) => ({ path: `/Volumes/main/apps/files/${index}.csv` }))]) {
    assert.equal(recordedFileOutput(JSON.stringify({ files: [{ node: 'out', files }] }), 'out', { volumes: ['main.apps.files'] }), undefined);
  }
  assert.deepEqual(recordedFileOutput(JSON.stringify({ files: [{ node: 'out', files: [] }] }), 'out', { volumes: ['main.apps.files'] }), { node: 'out', files: [] });
});

test('retains recorded write behavior without inferring it from the file path or current policy', () => {
  const files = [{ path: '/Volumes/main/apps/files/_designer_apps/old-namespace/report.csv' }];
  for (const behavior of ['run_artifact', 'shared_append', 'shared_workbook_update', undefined, 'unknown', null, {}]) {
    const receipt = recordedFileOutput(JSON.stringify({ files: [{ node: 'out', files, behavior }] }), 'out', { volumes: ['main.apps.files'] });
    assert.deepEqual(receipt, {
      node: 'out', files,
      ...(['run_artifact', 'shared_append', 'shared_workbook_update'].includes(behavior) ? { behavior } : {}),
    });
  }
});

test('each run downloads its recorded namespaced artifact rather than the latest output path', async (t) => {
  const h = await harness(t);
  const path = '/Volumes/main/apps/files/_designer_apps/submission/attempt/output_0/report.csv';
  h.state.receipts[0] = { node: 'output_0', behavior: 'run_artifact', files: [{ path }] };
  h.files.set(path, Buffer.from('first run\n'));
  h.files.set('/Volumes/main/apps/files/report.csv', Buffer.from('latest shared file\n'));
  h.files.set('/Volumes/main/apps/files/_designer_apps/new-submission/attempt/output_0/report.csv', Buffer.from('next run\n'));
  assert.equal(await (await h.call()).text(), 'first run\n');
  assert.deepEqual(h.state.reads, [{ volume: 'main.apps.files', path }]);
});

test('aborts incomplete transfers without deleting the source file', async (t) => {
  const h = await harness(t);
  h.state.stream = () => new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('p')); controller.close(); } });
  await assert.rejects(async () => { const response = await h.call(); await response.arrayBuffer(); });
  assert.equal(h.files.size, 1);
  assert.equal(h.state.reports.length, 1);
});
