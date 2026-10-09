import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'tsdown';

let outputDirectory, registerUploadRoutes, saveUpload, resolveUpload, viewerKey, UploadError;
let uploadDownloadRoute, FileParameterControl, LastRunLabel;
before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.upload-download-tests-', import.meta.url)));
  await build({
    entry: {
      uploads: 'server/uploads.ts', fileUploads: 'server/fileUploads.ts', routes: 'client/src/routes.ts',
      FileParameterControl: 'client/src/FileParameterControl.tsx', LastRunLabel: 'client/src/LastRunLabel.tsx',
    },
    config: false, tsconfig: 'tsconfig.client.json', outDir: outputDirectory,
    noExternal: [/^@databricks\/appkit-ui(?:\/|$)/],
    outExtensions: () => ({ js: '.mjs' }), logLevel: 'silent',
  });
  ({ registerUploadRoutes } = await import(pathToFileURL(join(outputDirectory, 'uploads.mjs')).href));
  ({ saveUpload, resolveUpload, viewerKey, UploadError } = await import(pathToFileURL(join(outputDirectory, 'fileUploads.mjs')).href));
  ({ uploadDownloadRoute } = await import(pathToFileURL(join(outputDirectory, 'routes.mjs')).href));
  ({ FileParameterControl } = await import(pathToFileURL(join(outputDirectory, 'FileParameterControl.mjs')).href));
  ({ LastRunLabel } = await import(pathToFileURL(join(outputDirectory, 'LastRunLabel.mjs')).href));
});
after(async () => { if (outputDirectory) await rm(outputDirectory, { recursive: true }); });

const storage = {
  volume: 'main.apps.files', path: '/Volumes/main/apps/files/designer_apps/app1',
  maxUploadFileSizeBytes: 5 * 1024 * 1024 * 1024,
};
const parameter = { name: 'path', label: 'Input file', type: 'file', defaultValue: '' };

async function harness(t, { filename = 'sales.csv', bytes = Buffer.from('price\n42\n'), name = 'path' } = {}) {
  const state = {
    jobId: '100', reads: [], reports: [],
    manifest: { storage, parameters: [{ ...parameter, name }, { ...parameter, name: 'other' }] },
  };
  // Preserve actual upload bytes and sidecars; only UC storage is replaced.
  const files = new Map();
  const store = {
    mkdir: async () => {},
    put: async (path, contents) => { assert.equal(files.has(path), false); files.set(path, Buffer.from(contents)); },
    putStream: async (path, stream) => {
      assert.equal(files.has(path), false);
      files.set(path, Buffer.from(await new Response(stream).arrayBuffer()));
    },
    read: async (path) => {
      if (!files.has(path)) throw new UploadError(404, 'This upload is no longer available.');
      return JSON.parse(files.get(path).toString());
    },
    size: async (path) => files.get(path)?.length,
    download: async (path) => {
      state.reads.push(path);
      if (state.downloadError) throw state.downloadError;
      return state.stream ? state.stream() : new ReadableStream({
        start(controller) { controller.enqueue(files.get(path)); controller.close(); },
      });
    },
    delete: async (path) => { files.delete(path); },
  };
  const owner = viewerKey('alice', '100');
  const upload = await saveUpload(store, storage, owner, name, filename, bytes);
  const { path } = await resolveUpload(store, storage, owner, name, upload.reference);
  const app = express();
  registerUploadRoutes(app, {
    manifest: async () => state.manifest,
    viewer: (req) => viewerKey(req.get('x-forwarded-user'), state.jobId),
    store: () => store,
    report: (error) => state.reports.push(error),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (options = {}) => fetch(
    `${origin}${uploadDownloadRoute(options.name ?? name, options.reference ?? upload.reference)}${options.query ?? ''}`,
    { ...options, headers: { 'x-forwarded-user': 'alice', ...options.headers } },
  );
  return { state, files, store, upload, path, call, origin };
}

test('downloads completed uploads repeatedly and concurrently without changing files or sidecars', async (t) => {
  const h = await harness(t);
  const original = new Map(h.files);
  const responses = await Promise.all([h.call(), h.call(), h.call()]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('content-length'), '9');
    assert.match(response.headers.get('content-disposition'), /attachment; filename="sales.csv"/);
    assert.equal(await response.text(), 'price\n42\n');
  }
  assert.deepEqual(h.files, original);
  assert.deepEqual(h.state.reads, [h.path, h.path, h.path]);
});

test('serves an upload confirmed by the HTTP upload route before any job is started', async (t) => {
  const h = await harness(t);
  const response = await fetch(`${h.origin}/api/designer/uploads/path`, {
    method: 'POST', headers: { 'x-forwarded-user': 'alice', 'content-type': 'application/octet-stream', 'x-file-name': 'new.json' },
    body: Buffer.from('{"value":1}'),
  });
  assert.equal(response.status, 201);
  const { upload } = await response.json();
  assert.equal(await (await h.call({ reference: upload.reference })).text(), '{"value":1}');
});

test('preserves binary bytes and Unicode filenames while ignoring caller-supplied paths', async (t) => {
  const filename = "データ #100%' (1).xlsx";
  const bytes = Buffer.from([0, 255, 1, 2, 128]);
  const h = await harness(t, { filename, bytes, name: 'file path/データ' });
  const response = await h.call({ query: '?path=/Volumes/main/apps/files/another.csv' });
  assert.equal(response.status, 200);
  const disposition = response.headers.get('content-disposition');
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), filename);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.deepEqual(h.state.reads, [h.path]);
});

for (const [label, change, options, status] of [
  ['another viewer', () => {}, { headers: { 'x-forwarded-user': 'bob' } }, 404],
  ['missing identity', () => {}, { headers: { 'x-forwarded-user': '' } }, 401],
  ['another parameter', () => {}, { name: 'other' }, 404],
  ['another app', (h) => { h.state.jobId = '200'; }, {}, 404],
  ['a removed parameter', (h) => { h.state.manifest.parameters = []; }, {}, 404],
  ['a text parameter', (h) => { h.state.manifest.parameters[0].type = 'text'; }, {}, 404],
  ['missing storage', (h) => { delete h.state.manifest.storage; }, {}, 404],
  ['a different upload root', (h) => { h.state.manifest.storage = { ...storage, path: storage.path.replace('app1', 'app2') }; }, {}, 404],
  ['a missing file', (h) => { h.files.delete(h.path); }, {}, 409],
  ['changed file bytes', (h) => { h.files.set(h.path, Buffer.from('changed')); }, {}, 409],
  ['an incomplete upload', (h) => { h.files.delete(`${h.path.slice(0, h.path.lastIndexOf('/'))}.json`); }, {}, 404],
  ['an invalid reference', () => {}, { reference: 'upload:invalid' }, 400],
  ['an arbitrary volume path', () => {}, { reference: '/Volumes/main/apps/files/private.csv' }, 400],
  ['a HEAD request', () => {}, { method: 'HEAD' }, 405],
  ['a partial download', () => {}, { headers: { range: 'bytes=0-3' } }, 416],
]) {
  test(`refuses ${label} before streaming file bytes`, async (t) => {
    const h = await harness(t);
    change(h);
    const response = await h.call(options);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(h.state.reads, []);
  });
}

test('rejects an unsafe completion record and reports storage failures without exposing file paths', async (t) => {
  const h = await harness(t);
  const sidecar = `${h.path.slice(0, h.path.lastIndexOf('/'))}.json`;
  const original = h.files.get(sidecar);
  h.files.set(sidecar, Buffer.from(JSON.stringify({ ...h.upload, filename: '../secret.csv' })));
  assert.equal((await h.call()).status, 409);
  assert.deepEqual(h.state.reads, []);
  h.files.set(sidecar, original);
  h.state.downloadError = new Error(`Unavailable: ${h.path}`);
  const response = await h.call();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Could not download/);
  assert.equal(h.state.reports.length, 1);
});

for (const [label, bytes] of [['short', Buffer.from('p')], ['oversized', Buffer.alloc(10)]]) {
  test(`aborts ${label} transfers and retains the original upload for retry`, async (t) => {
    const h = await harness(t);
    const original = new Map(h.files);
    h.state.stream = () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    await assert.rejects(async () => { const response = await h.call(); await response.arrayBuffer(); });
    assert.equal(h.state.reports.length, 1);
    assert.deepEqual(h.files, original);
    delete h.state.stream;
    assert.equal(await (await h.call()).text(), 'price\n42\n');
  });
}

test('cancels UC reading on a disconnected download and retains the upload', async (t) => {
  const h = await harness(t);
  const original = new Map(h.files);
  let notify;
  const cancelled = new Promise((resolve) => { notify = resolve; });
  h.state.stream = () => new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from('p')); },
    cancel() { notify(); },
  });
  const controller = new AbortController();
  const response = await h.call({ signal: controller.signal });
  const reader = response.body.getReader();
  assert.equal(Buffer.from((await reader.read()).value).toString(), 'p');
  controller.abort();
  const timeout = setTimeout(() => notify('timeout'), 2000);
  try { assert.equal(await cancelled, undefined); } finally { clearTimeout(timeout); reader.releaseLock(); }
  assert.deepEqual(h.files, original);
});

test('shows a Download action only for completed uploads and keeps it enabled while running', async (t) => {
  const h = await harness(t);
  const file = new File(['price\n42\n'], 'sales.csv');
  const props = { name: 'path', file, error: undefined, onFileChange: () => {}, disabled: true };
  for (const uploadReference of [undefined, '', 'upload:bad', '/Volumes/private/file.csv']) {
    const html = renderToStaticMarkup(createElement(FileParameterControl, { ...props, uploadReference }));
    assert.doesNotMatch(html, /aria-label="Download/);
  }
  const html = renderToStaticMarkup(createElement(FileParameterControl, { ...props, uploadReference: h.upload.reference }));
  assert.match(html, /aria-label="Download sales.csv"/);
  const href = /href="([^"]+\/download)"/.exec(html)[1];
  assert.equal(await (await fetch(`${h.origin}${href}`, { headers: { 'x-forwarded-user': 'alice' } })).text(), 'price\n42\n');
});

test('links uploaded filenames in run summaries without making ordinary parameters downloadable', async (t) => {
  const h = await harness(t);
  const props = {
    run: { jobRunId: '1', endTime: 1000 }, parameters: { path: h.upload.reference },
    parameterDisplayValues: { path: h.upload.filename }, declared: [parameter], variant: 'historical',
  };
  const html = renderToStaticMarkup(createElement(LastRunLabel, props));
  assert.match(html, /Selected run/);
  assert.match(html, /aria-label="Download sales.csv"/);
  const href = /href="([^"]+\/download)"/.exec(html)[1];
  assert.equal(await (await fetch(`${h.origin}${href}`, { headers: { 'x-forwarded-user': 'alice' } })).text(), 'price\n42\n');
  for (const changes of [{ declared: [] }, { declared: [{ ...parameter, type: 'text' }] }, { parameterDisplayValues: undefined }]) {
    assert.doesNotMatch(renderToStaticMarkup(createElement(LastRunLabel, { ...props, ...changes })), /aria-label="Download/);
  }
});
