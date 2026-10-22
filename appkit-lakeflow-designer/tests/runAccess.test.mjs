import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { ApiError, files, createWorkspaceClient } from '@databricks/appkit';
import { build } from 'tsdown';

let outputDirectory;
before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.server-tests-', import.meta.url)));
  const adapter = join(outputDirectory, 'appkit.mjs');
  // Replace AppKit's process bootstrap only. Routes and the authenticated SDK transport are real.
  await writeFile(adapter, `
    export const server = () => ({});
    export const ApiError = globalThis.designerTest.ApiError;
    export const files = (...args) => globalThis.designerTest.files(...args);
    export const createWorkspaceClient = (options) => globalThis.designerTest.createClient(options);
    export const createApp = async ({ onPluginsReady }) => onPluginsReady({
      server: { extend: (register) => register(globalThis.designerTest.app) },
    });
  `);
  await build({
    entry: { server: 'server/server.ts' }, config: false, tsconfig: 'tsconfig.server.json',
    alias: { '@databricks/appkit': adapter }, noExternal: ['@databricks/appkit'],
    outDir: join(outputDirectory, 'bundle'), outExtensions: () => ({ js: '.mjs' }), logLevel: 'silent',
  });
});
after(async () => { if (outputDirectory) await rm(outputDirectory, { recursive: true }); });

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

let instance = 0;
async function harness(t) {
  const revision = 'a'.repeat(64);
  const parameters = { _lb_runner_revision: revision, hidden: 'published default', choice: 'A' };
  const state = {
    requests: [], submissions: [], cancellations: [], runs: [],
    manifest: {
      version: 7, appName: 'Report', runner: { revision, parameters },
      parameters: [{ name: 'choice', label: 'Choice', type: 'text', defaultValue: 'A' }],
      blocks: [{ type: 'output', id: 'out', nodeId: 'source', port: 'data', label: 'Data' }],
    },
    job: { settings: { tasks: [{ notebook_task: {
      notebook_path: `/Users/author/app/runner-${revision}.designer.py`, base_parameters: { ...parameters },
    } }] } },
  };
  const workspaceUrl = await listen(t, createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : undefined;
    const url = new URL(req.url, 'http://workspace.test');
    state.requests.push({ method: req.method, path: url.pathname, body });
    assert.equal(req.headers.authorization, 'Bearer test-only');
    res.setHeader('Content-Type', 'application/json');
    const send = (value) => res.end(JSON.stringify(value));
    if (url.pathname.endsWith('/jobs/get')) return send(state.job);
    if (url.pathname.endsWith('/workspace/export')) {
      return send({ content: Buffer.from(JSON.stringify(state.manifest)).toString('base64') });
    }
    if (url.pathname.endsWith('/jobs/run-now')) {
      state.submissions.push(body);
      const run = {
        run_id: 1000 + state.submissions.length, job_id: 10, start_time: Date.now(),
        job_parameters: Object.entries(body.job_parameters).map(([name, value]) => ({ name, value })),
        state: { life_cycle_state: 'RUNNING' },
      };
      state.runs.unshift(run);
      return send({ run_id: run.run_id });
    }
    if (url.pathname.endsWith('/jobs/runs/get')) {
      return send(state.runs.find((run) => run.run_id === Number(url.searchParams.get('run_id'))));
    }
    if (url.pathname.endsWith('/jobs/runs/cancel')) {
      state.cancellations.push(body.run_id);
      return send({});
    }
    if (url.pathname.endsWith('/jobs/runs/list')) {
      const completed = url.searchParams.get('completed_only') === 'true';
      const runs = state.runs.filter((run) => Boolean(run.state.result_state) === completed);
      const offset = Number(url.searchParams.get('page_token') || 0);
      const end = offset + Number(url.searchParams.get('limit') || 25);
      return send({ runs: runs.slice(offset, end), ...(end < runs.length ? { next_page_token: String(end) } : {}) });
    }
    res.statusCode = 404;
    return send({ error_code: 'NOT_FOUND', message: url.pathname });
  }));
  const app = express();
  app.use(express.json());
  globalThis.designerTest = {
    app, ApiError, files,
    createClient: (options) => createWorkspaceClient(options ?? { host: workspaceUrl, token: 'test-only' }),
  };
  const oldJob = process.env.DATABRICKS_JOB_ID;
  const oldApp = process.env.DATABRICKS_APP_ID;
  process.env.DATABRICKS_JOB_ID = '10';
  process.env.DATABRICKS_APP_ID = 'app-id';
  await import(pathToFileURL(join(outputDirectory, 'bundle/server.mjs')).href + `?instance=${instance++}`);
  t.after(() => {
    if (oldJob === undefined) delete process.env.DATABRICKS_JOB_ID; else process.env.DATABRICKS_JOB_ID = oldJob;
    if (oldApp === undefined) delete process.env.DATABRICKS_APP_ID; else process.env.DATABRICKS_APP_ID = oldApp;
    delete globalThis.designerTest;
  });
  const appUrl = await listen(t, createServer(app));
  const call = (path, viewer = 'alice', method = 'GET', body) => fetch(`${appUrl}/api/designer${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-user': viewer, 'x-forwarded-email': `${viewer}@example.test` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { state, call };
}

test('ordinary App runs stay within the submitting viewer without granting Job permissions', async (t) => {
  const { state, call } = await harness(t);
  const config = await (await call('/config')).json();
  assert.equal(config.runnable, true);
  assert.equal(config.manifest.runner, undefined);
  const submitted = await call('/run', 'alice', 'POST', { params: { choice: 'B', hidden: 'override', _lb_app_viewer: 'bob' } });
  assert.equal(submitted.status, 200);
  const { jobRunId } = await submitted.json();
  assert.equal(state.submissions[0].job_parameters.hidden, 'published default');
  const run = await (await call(`/run/${jobRunId}`)).json();
  assert.deepEqual(run.parameters, { choice: 'B' });
  assert.equal((await call(`/run/${jobRunId}`, 'bob')).status, 404);
  assert.equal((await call(`/run/${jobRunId}`, 'bob', 'DELETE')).status, 404);
  assert.equal((await call('/run', '', 'POST', {})).status, 401);
  assert.equal((await call(`/run/${jobRunId}`, 'alice', 'DELETE')).status, 200);
  assert.deepEqual(state.cancellations, [Number(jobRunId)]);
  assert.deepEqual(state.requests.filter(({ path }) => path.includes('/permissions/')), []);
});

test('submissions pause until runner code and every default match the manifest', async (t) => {
  const { state, call } = await harness(t);
  const notebook = state.job.settings.tasks[0].notebook_task;
  const published = structuredClone(notebook);
  for (const changed of [
    { ...published, notebook_path: `/Users/author/app/runner-${'b'.repeat(64)}.designer.py` },
    { ...published, base_parameters: { ...published.base_parameters, hidden: 'new default' } },
    { ...published, base_parameters: { ...published.base_parameters, added: 'new input' } },
  ]) {
    Object.assign(notebook, changed);
    const config = await (await call('/config')).json();
    assert.equal(config.runnable, false);
    assert.equal(config.notRunnableReason, 'updating');
    const refused = await call('/run', 'alice', 'POST', {});
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /updating/);
  }
  assert.deepEqual(state.submissions, []);
  Object.assign(notebook, published);
  assert.equal((await call('/run', 'alice', 'POST', {})).status, 200);
});

test('history preserves a continuation beyond 200 other viewers’ runs', async (t) => {
  const { state, call } = await harness(t);
  const response = await call('/run', 'alice', 'POST', {});
  const { jobRunId } = await response.json();
  const ownRun = state.runs[0];
  ownRun.state = { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' };
  state.runs.unshift(...Array.from({ length: 200 }, (_, index) => ({
    ...ownRun, run_id: 2000 + index, start_time: ownRun.start_time + 200 - index,
    job_parameters: [{ name: '_lb_app_viewer', value: 'another-viewer' }],
  })));
  const first = await (await call('/runs')).json();
  assert.deepEqual(first.runs, []);
  assert.equal(first.hasMore, true);
  const older = await (await call(`/runs?cursor=${first.nextPageToken}`)).json();
  assert.deepEqual(older.runs.map((run) => run.jobRunId), [jobRunId]);
  assert.equal(older.hasMore, false);
  const search = await (await call('/last-run')).json();
  assert.equal(search.status, 'searching');
  const last = await (await call(`/last-run?cursor=${search.nextPageToken}`)).json();
  assert.equal(last.status, 'found');
  assert.equal(last.run.jobRunId, jobRunId);
});
