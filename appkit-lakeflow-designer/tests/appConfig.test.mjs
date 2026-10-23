import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'tsdown';

let outputDirectory;
let moduleUrl;
before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.app-config-tests-', import.meta.url)));
  await build({
    entry: { appConfig: 'client/src/appConfig.ts' },
    config: false,
    tsconfig: 'tsconfig.client.json',
    outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  moduleUrl = pathToFileURL(join(outputDirectory, 'appConfig.mjs')).href;
});
after(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true });
});

const manifest = {
  version: 8, appName: 'Startup recovery', parameters: [],
  blocks: [{ type: 'output', id: 'table', label: 'Output', nodeId: 'source', port: 'data' }],
};
const startingResponse = () => new Response('<!doctype html><title>App Starting - Databricks</title>', {
  status: 202, headers: { 'Content-Type': 'text/html; charset=utf-8' },
});
const readyResponse = () => Response.json({ manifest, runnable: true });
const newDocument = (name) => import(`${moduleUrl}?document=${encodeURIComponent(name)}`);

// Browser storage and navigation are external boundaries; the real configuration reader runs here.
function browser(context, { denyStorage = false } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  let reloads = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      get sessionStorage() {
        if (denyStorage) throw new Error('Storage access denied');
        return {
          getItem: (key) => values.get(key) ?? null,
          setItem: (key, value) => values.set(key, value),
          removeItem: (key) => values.delete(key),
        };
      },
      location: { reload: () => { reloads += 1; } },
    },
  });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
  return { reloads: () => reloads };
}

test('gateway startup reloads once and concurrent configuration reads do not submit a Job', async (context) => {
  const page = browser(context);
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (...args) => {
    requests.push(args);
    return startingResponse();
  });
  const config = await newDocument(context.name);
  assert.deepEqual(await Promise.all([config.fetchAppConfig(), config.fetchAppConfig()]), [
    { status: 'loading' }, { status: 'loading' },
  ]);
  assert.equal(page.reloads(), 1);
  assert.deepEqual(requests, [['/api/designer/config'], ['/api/designer/config']]);
});

test('startup that persists after navigation stops reloading until a valid configuration loads', async (context) => {
  const page = browser(context);
  const request = context.mock.method(globalThis, 'fetch', async () => startingResponse());
  const first = await newDocument(context.name + ':before-reload');
  assert.deepEqual(await first.fetchAppConfig(), { status: 'loading' });
  const second = await newDocument(context.name + ':after-reload');
  const blocked = await second.fetchAppConfig();
  assert.equal(blocked.status, 'unavailable');
  assert.match(blocked.detail, /Reload the page/);
  assert.equal(page.reloads(), 1);

  request.mock.mockImplementation(async () => Response.json({ manifest: { ...manifest, version: 7 } }));
  assert.equal((await second.fetchAppConfig()).status, 'unavailable');
  request.mock.mockImplementation(async () => startingResponse());
  assert.equal((await second.fetchAppConfig()).status, 'unavailable');
  assert.equal(page.reloads(), 1);

  request.mock.mockImplementation(async () => readyResponse());
  assert.equal((await second.fetchAppConfig()).status, 'ready');
  request.mock.mockImplementation(async () => startingResponse());
  assert.deepEqual(await second.fetchAppConfig(), { status: 'loading' });
  assert.equal(page.reloads(), 2);
});

test('late healthy responses in the departing document do not remove the reload guard', async (context) => {
  const page = browser(context);
  const request = context.mock.method(globalThis, 'fetch', async () => startingResponse());
  const first = await newDocument(context.name + ':before-reload');
  await first.fetchAppConfig();
  request.mock.mockImplementation(async () => readyResponse());
  assert.equal((await first.fetchAppConfig()).status, 'ready');
  request.mock.mockImplementation(async () => startingResponse());
  const second = await newDocument(context.name + ':after-reload');
  assert.equal((await second.fetchAppConfig()).status, 'unavailable');
  assert.equal(page.reloads(), 1);
});

test('denied session storage keeps configuration usable and never risks a reload loop', async (context) => {
  const page = browser(context, { denyStorage: true });
  const request = context.mock.method(globalThis, 'fetch', async () => startingResponse());
  const config = await newDocument(context.name);
  assert.equal((await config.fetchAppConfig()).status, 'unavailable');
  assert.equal((await config.fetchAppConfig()).status, 'unavailable');
  assert.equal(page.reloads(), 0);
  request.mock.mockImplementation(async () => readyResponse());
  assert.equal((await config.fetchAppConfig()).status, 'ready');
});

for (const [label, response] of [
  ['ordinary HTML', () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } })],
  ['JSON startup', () => Response.json({ status: 'starting' }, { status: 202 })],
  ['plain-text accepted response', () => new Response('starting', { status: 202 })],
  ['unsupported manifest', () => Response.json({ manifest: { ...manifest, version: 7 } })],
  ['missing manifest', () => Response.json({ manifest: null, runnable: false })],
  ...[401, 403, 409, 500, 502, 503].map((status) => [String(status), () => new Response('Unavailable', { status })]),
]) {
  test(`${label} remains a configuration error without reloading`, async (context) => {
    const page = browser(context);
    context.mock.method(globalThis, 'fetch', async () => response());
    const config = await newDocument(context.name);
    assert.equal((await config.fetchAppConfig()).status, 'unavailable');
    assert.equal(page.reloads(), 0);
  });
}

test('network failures remain configuration errors without reloading', async (context) => {
  const page = browser(context);
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  const config = await newDocument(context.name);
  assert.deepEqual(await config.fetchAppConfig(), { status: 'unavailable', detail: 'Failed to fetch' });
  assert.equal(page.reloads(), 0);
});
