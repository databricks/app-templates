import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'tsdown';

let outputDirectory;
let viewerKey;
let parseRunSnapshot, LastRunLabel;
let ParameterForm, parseAppManifest, initialValuesFor;
let instance = 0;
const harnessKey = Symbol.for('designer-upload-route-tests');
const originalJobId = process.env.DATABRICKS_JOB_ID;

before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.upload-route-tests-', import.meta.url)));
  await build({
    entry: { server: 'server/server.ts', fileUploads: 'server/fileUploads.ts' },
    config: false,
    tsconfig: 'tsconfig.server.json',
    outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
    noExternal: ['@databricks/appkit'],
    // Only replace HTTP registration and the remote workspace boundary, not route handlers.
    plugins: [
      {
        name: 'appkit-test-boundary',
        resolveId(id) {
          if (id === '@databricks/appkit') return '\0appkit-test-boundary';
        },
        load(id) {
          if (id !== '\0appkit-test-boundary') return;
          return `
          const harness = globalThis[Symbol.for('designer-upload-route-tests')];
          export const createWorkspaceClient = () => harness.client;
          export class ApiError extends Error {}
          export const server = () => ({ name: 'server' });
          export const files = (config) => ({ name: 'files', config });
          export const createApp = async (options) => {
            harness.apps.push(options.plugins);
            if (options.onPluginsReady) {
              await options.onPluginsReady({ server: { extend: harness.extend } });
            }
            return { files: () => harness.volume };
          };
        `;
        },
      },
    ],
  });
  ({ viewerKey } = await import(pathToFileURL(join(outputDirectory, 'fileUploads.mjs')).href));
  await build({
    entry: {
      payload: 'client/src/payload.ts', LastRunLabel: 'client/src/LastRunLabel.tsx',
      ParameterForm: 'client/src/ParameterForm.tsx', appConfig: 'client/src/appConfig.ts',
    },
    config: false,
    tsconfig: 'tsconfig.client.json',
    noExternal: [/^@databricks\/appkit-ui(?:\/|$)/],
    outDir: outputDirectory,
    clean: false,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  ({ parseRunSnapshot } = await import(pathToFileURL(join(outputDirectory, 'payload.mjs')).href));
  ({ LastRunLabel } = await import(pathToFileURL(join(outputDirectory, 'LastRunLabel.mjs')).href));
  ({ ParameterForm } = await import(pathToFileURL(join(outputDirectory, 'ParameterForm.mjs')).href));
  ({ parseAppManifest, initialValuesFor } = await import(pathToFileURL(join(outputDirectory, 'appConfig.mjs')).href));
});

after(async () => {
  delete globalThis[harnessKey];
  if (originalJobId === undefined) delete process.env.DATABRICKS_JOB_ID;
  else process.env.DATABRICKS_JOB_ID = originalJobId;
  if (outputDirectory) await rm(outputDirectory, { recursive: true });
});

const manifest = {
  version: 6,
  appName: 'Uploads',
  storage: {
    volume: 'main.default.designer_app1',
    path: '/Volumes/main/default/designer_app1/designer_apps/app1',
    maxUploadFileSizeBytes: 5 * 1024 * 1024 * 1024,
  },
  parameters: [{ name: 'path', label: 'CSV', type: 'file', defaultValue: '/private/author.csv' }],
  blocks: [{ type: 'output', id: 'data', label: 'Data', nodeId: 'source', port: 'data' }],
};

async function serverHarness() {
  const routes = new Map();
  const middleware = [];
  const state = {
    manifest, runs: [], listed: [], reads: [], cancelled: [], outputReads: [], submissions: [], apps: [],
    notebookPath: '/Users/author/app/runner', notebookSource: '', workspaceReads: [], commands: undefined,
  };
  const stored = new Map();
  globalThis[harnessKey] = {
    apps: state.apps,
    volume: {
      createDirectory: async () => {},
      upload: async (path, bytes, options) => {
        assert.equal(options.overwrite, false);
        assert.equal(stored.has(path), false);
        stored.set(
          path,
          bytes instanceof ReadableStream
            ? Buffer.from(await new Response(bytes).arrayBuffer())
            : Buffer.from(bytes),
        );
      },
      read: async (path, options) => {
        assert.equal(options.maxSize, 16 * 1024);
        return stored.get(path).toString();
      },
      metadata: async (path) => ({ contentLength: stored.get(path)?.length }),
      list: async (folder) => [...stored.keys()]
        .filter((path) => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/'))
        .map((path) => ({ name: path.slice(folder.length + 1), is_directory: false })),
      delete: async (path) => { stored.delete(path); },
    },
    extend(apply) {
      apply({
        use: (_path, handler) => middleware.push(handler),
        ...Object.fromEntries(
          ['get', 'post', 'delete', 'all'].map((method) => [
            method,
            (path, handler) => routes.set(`${method}:${path}`, handler),
          ]),
        ),
      });
    },
    client: {
      jobs: {
        get: async () => ({ settings: { tasks: [{ notebook_task: { notebook_path: state.notebookPath } }] } }),
        getRun: async ({ run_id }) => {
          state.reads.push(run_id);
          return state.runs.find((run) => run.run_id === run_id);
        },
        listRuns: async function* ({ active_only }) {
          if (!active_only) yield* state.listed;
        },
        exportRun: async ({ run_id }) => {
          state.outputReads.push(run_id);
          const model = Buffer.from(
            encodeURIComponent(
              JSON.stringify({
                commands: state.commands ?? [
                  {
                    command: 'display(ctx["source.data"])',
                    results: { type: 'table', schema: [], data: [], overflow: false },
                  },
                ],
              }),
            ),
          ).toString('base64');
          return { views: [{ content: `<script>__DATABRICKS_NOTEBOOK_MODEL = '${model}'</script>` }] };
        },
        cancelRun: async ({ run_id }) => {
          state.cancelled.push(run_id);
        },
        runNow: async (request) => {
          state.submissions.push(request);
          return { run_id: 1000 };
        },
      },
      toLegacyWorkspaceClient: () => ({
        workspace: {
          export: async ({ path, format }) => {
            state.workspaceReads.push({ path, format });
            const content = path === state.notebookPath ? state.notebookSource : JSON.stringify(state.manifest);
            return { content: Buffer.from(content).toString('base64') };
          },
        },
      }),
    },
  };
  process.env.DATABRICKS_JOB_ID = '100';
  await import(`${pathToFileURL(join(outputDirectory, 'server.mjs')).href}?instance=${++instance}`);
  const request = async (method, path, { viewer = 'alice', params = {}, body, headers = {}, bytes } = {}) => {
    const req = Object.assign(Readable.from(bytes ? [bytes] : []), {
      method: method.toUpperCase(),
      params,
      body,
      query: {},
      get: (name) => (name === 'x-forwarded-user' ? viewer : headers[name]),
    });
    const response = { status: 200, body: undefined, headers: {} };
    const res = {
      status(code) {
        response.status = code;
        return res;
      },
      json(value) {
        response.body = value;
        return res;
      },
      setHeader(name, value) {
        response.headers[name] = value;
      },
    };
    for (const handler of middleware) handler(req, res, () => {});
    const handler = routes.get(`${method}:${path}`) ?? routes.get(`all:${path}`);
    assert.ok(handler, `registered ${method} ${path}`);
    await handler(req, res);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    return response;
  };
  return { state, request };
}

function run(id, owner, params = {}) {
  return {
    run_id: id,
    job_id: 100,
    start_time: id,
    end_time: id + 1,
    state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' },
    tasks: [{ run_id: id + 1000 }],
    overriding_parameters: { notebook_params: { _lb_app_viewer: viewerKey(owner, '100'), ...params } },
  };
}

for (const filename of ['sales.csv', 'sales.xlsx', 'data.json', 'data.csv.gz', 'carmax_car_prices copy (1).xlsx', 'データ.xlsx']) {
  test(`shows ${filename} on completion without refreshing and preserves it in history`, async () => {
    const { state, request } = await serverHarness();
    state.runs = [
      run(20, 'bob'),
      run(10, 'alice', { path: `/Volumes/data/829dcaa7-e505-49c1-b6d0-73d1841e990a/${filename}` }),
    ];
    state.listed = state.runs.map(({ run_id, job_id }) => ({ run_id, job_id }));
    const status = await request('get', '/api/designer/run/:jobRunId', { params: { jobRunId: '10' } });
    assert.equal(status.status, 200);
    const snapshot = parseRunSnapshot(status.body);
    assert.equal(snapshot.terminal, true);
    assert.deepEqual(snapshot.parameters, { path: 'upload:829dcaa7-e505-49c1-b6d0-73d1841e990a' });
    assert.deepEqual(snapshot.parameterDisplayValues, { path: filename });
    const html = renderToStaticMarkup(createElement(LastRunLabel, {
      run: snapshot,
      parameters: snapshot.parameters,
      parameterDisplayValues: snapshot.parameterDisplayValues,
      declared: manifest.parameters,
      variant: 'justFinished',
    }));
    assert.match(html, /Just finished/);
    assert.ok(html.includes(filename));
    assert.doesNotMatch(html, /upload:|\/Volumes\//);

    const history = await request('get', '/api/designer/runs');
    assert.deepEqual(
      history.body.runs.map(({ jobRunId }) => jobRunId),
      ['10'],
    );
    assert.deepEqual(history.body.runs[0].parameters, { path: 'upload:829dcaa7-e505-49c1-b6d0-73d1841e990a' });
    assert.deepEqual(history.body.runs[0].parameterDisplayValues, { path: filename });
    const last = await request('get', '/api/designer/last-run');
    assert.equal(last.body.status, 'found');
    assert.equal(last.body.run.jobRunId, '10');
    assert.equal(last.body.run.taskRunId, '1010');
    assert.equal(last.body.run.resultState, 'SUCCESS');
    assert.deepEqual(last.body.parameters, { path: 'upload:829dcaa7-e505-49c1-b6d0-73d1841e990a' });
    assert.deepEqual(last.body.parameterDisplayValues, { path: filename });
    assert.deepEqual(state.outputReads, [1010, 1010]);
  });
}

test('live status preserves ordinary parameters and leaves missing recorded values absent', async () => {
  const { state, request } = await serverHarness();
  state.manifest = {
    ...manifest,
    version: 6,
    storage: undefined,
    parameters: [{ name: 'year', label: 'Year', type: 'text', defaultValue: '2015' }],
  };
  state.runs = [run(10, 'alice', { year: '2016', ld_display_outputs_for: 'source', _lb_collect_row_counts: 'true' })];
  let response = await request('get', '/api/designer/run/:jobRunId', { params: { jobRunId: '10' } });
  let snapshot = parseRunSnapshot(response.body);
  assert.deepEqual(snapshot.parameters, { year: '2016' });
  assert.equal(snapshot.parameterDisplayValues, undefined);

  delete state.runs[0].overriding_parameters;
  response = await request('get', '/api/designer/run/:jobRunId', { params: { jobRunId: '10' } });
  snapshot = parseRunSnapshot(response.body);
  assert.equal(snapshot.parameters, undefined);
  assert.equal(snapshot.parameterDisplayValues, undefined);
});

test('run APIs return only outputs selected in the published manifest', async () => {
  const { state, request } = await serverHarness();
  state.runs = [run(10, 'alice')];
  state.listed = [{ run_id: 10, job_id: 100 }];
  const table = { type: 'table', schema: [{ name: 'value', type: 'long' }], data: [[1]], overflow: false };
  state.commands = [
    { command: 'display(ctx["source.data"])', results: table },
    { command: 'display(ctx["source.metadata"])', results: table },
    { command: 'display(ctx["other.data"])', results: table },
  ];

  for (const response of [
    await request('get', '/api/designer/run/:jobRunId', { params: { jobRunId: '10' } }),
    await request('get', '/api/designer/last-run'),
  ]) {
    assert.equal(response.status, 200);
    assert.equal(response.body.result.outcome, 'outputs');
    assert.deepEqual(response.body.result.outputs.map((output) => output.id), ['data']);
    assert.equal(response.body.result.outputs[0].outcome.outcome, 'result');
  }
});

test('rejects unsupported manifest versions and malformed optional storage', async () => {
  const { state, request } = await serverHarness();
  for (const invalid of [
    { ...manifest, version: 3 },
    { ...manifest, version: 4 },
    { ...manifest, storage: null, parameters: [] },
    { ...manifest, storage: { ...manifest.storage, path: '/Volumes/main/default/other' }, parameters: [] },
  ]) {
    state.manifest = invalid;
    assert.equal((await request('post', '/api/designer/run')).status, 409);
  }
  assert.deepEqual(state.submissions, []);
});

for (const choices of [['us-west', 'us-east'], [], undefined, [42]]) {
  // @ui-test-skill-generated
  test(`projects and renders a published combobox with suggestions ${JSON.stringify(choices)}`, async () => {
    const { state, request } = await serverHarness();
    const parameter = { name: 'region', label: 'Region', type: 'combobox', defaultValue: 'custom' };
    state.manifest = { ...manifest, storage: undefined, parameters: [{ ...parameter, choices }] };
    const response = await request('get', '/api/designer/config');
    assert.equal(response.status, 200);
    const validChoices = Array.isArray(choices) && choices.every((choice) => typeof choice === 'string');
    const expected = { ...parameter, ...(validChoices ? { choices } : {}) };
    assert.deepEqual(response.body.manifest.parameters, [expected]);
    const parsed = parseAppManifest(response.body.manifest);
    assert.deepEqual(parsed.parameters, [expected]);

    const html = renderToStaticMarkup(createElement(ParameterForm, {
      parameters: parsed.parameters, values: {}, onChange: () => {}, onRun: () => {}, running: false, runnable: true,
    }));
    assert.match(html, /for="region"[^>]*>Region<\/label>/);
    assert.match(html, /<input[^>]*id="region"[^>]*value="custom"/);
    const listId = html.match(/\blist="([^"]+)"/)?.[1];
    assert.ok(listId);
    assert.ok(html.includes(`<datalist id="${listId}">`));
    if (validChoices) {
      for (const choice of choices) assert.ok(html.includes(`<option value="${choice}">`));
    }
    assert.equal(html.includes('<option'), validChoices && choices.length > 0);
  });
}

for (const value of ['us-east', 'custom-value']) {
  // @ui-test-skill-generated
  test(`submits the combobox value ${value} without enforcing its suggestions`, async () => {
    const { state, request } = await serverHarness();
    state.manifest = {
      ...manifest, storage: undefined,
      parameters: [{ name: 'region', label: 'Region', type: 'combobox', defaultValue: 'us-west', choices: ['us-west', 'us-east'] }],
    };
    const response = await request('post', '/api/designer/run', { body: { params: { region: value } } });
    assert.equal(response.status, 200);
    assert.equal(state.submissions.at(-1).notebook_params.region, value);
  });
}

const multiselectParameter = {
  name: 'region', label: 'Regions', type: 'multiselect', defaultValue: 'us-west, us-east ',
  choices: ['us-west', ' us-east ', 'eu-west'],
};

for (const defaultValue of [multiselectParameter.defaultValue, '']) {
  test(`projects and renders labelled multi-select choices with default ${JSON.stringify(defaultValue)}`, async () => {
    const { state, request } = await serverHarness();
    const parameter = { ...multiselectParameter, defaultValue };
    state.manifest = { ...manifest, storage: undefined, parameters: [parameter] };
    const response = await request('get', '/api/designer/config');
    assert.equal(response.status, 200);
    assert.equal(response.body.runnable, true);
    assert.deepEqual(response.body.manifest.parameters, [parameter]);
    const parsed = parseAppManifest(response.body.manifest);
    assert.deepEqual(parsed.parameters, [parameter]);

    const html = renderToStaticMarkup(createElement(ParameterForm, {
      parameters: parsed.parameters, values: initialValuesFor(parsed),
      onChange: () => {}, onRun: () => {}, running: false, runnable: true,
    }));
    assert.match(html, /role="group" aria-label="Regions"/);
    const labels = new Map([...html.matchAll(/<label\b[^>]*for="([^"]+)"[^>]*>([^<]*)<\/label>/g)]
      .map((match) => [match[1], match[2]]));
    const checkboxes = [...html.matchAll(/<button\b[^>]*role="checkbox"[^>]*>/g)];
    assert.equal(checkboxes.length, parameter.choices.length);
    for (const [index, [button]] of checkboxes.entries()) {
      const id = button.match(/\bid="([^"]+)"/)?.[1];
      assert.ok(id);
      const choice = parameter.choices[index];
      assert.equal(labels.get(id), choice);
      assert.equal(button.match(/aria-checked="([^"]+)"/)?.[1], String(defaultValue.split(',').includes(choice)));
    }
  });
}

for (const [description, submitted, expected] of [
  ['offered selections in chosen order', 'eu-west,us-west', 'eu-west,us-west'],
  ['whitespace in an offered choice', ' us-east ', ' us-east '],
  ['an explicitly empty selection', '', ''],
  ['the default when omitted', undefined, multiselectParameter.defaultValue],
]) {
  test(`submits multi-select ${description} as one notebook string`, async () => {
    const { state, request } = await serverHarness();
    state.manifest = { ...manifest, storage: undefined, parameters: [multiselectParameter] };
    const params = submitted === undefined ? {} : { region: submitted };
    const response = await request('post', '/api/designer/run', { body: { params } });
    assert.equal(response.status, 200);
    assert.equal(state.submissions.length, 1);
    assert.equal(state.submissions[0].notebook_params.region, expected);
    assert.equal(state.submissions[0].notebook_params.ld_display_outputs_for, 'source');
    assert.equal(state.submissions[0].notebook_params._lb_collect_row_counts, 'true');
  });
}

for (const value of ['unknown', 'us-west,unknown', 'us-west,', ',us-west', 'us-west,,eu-west', null, ['us-west'], 42]) {
  test(`refuses malformed multi-select submission ${JSON.stringify(value)} without starting a Job`, async () => {
    const { state, request } = await serverHarness();
    state.manifest = { ...manifest, storage: undefined, parameters: [multiselectParameter] };
    const response = await request('post', '/api/designer/run', { body: { params: { region: value } } });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, '"Regions" must contain only the offered choices.');
    assert.deepEqual(state.submissions, []);
  });
}

for (const invalid of [
  { choices: undefined }, { choices: [] }, { choices: ['us-west', ''] },
  { choices: ['us-west', 'us-east,eu-west'] }, { choices: ['us-west', 42] },
  { defaultValue: 'unknown' }, { defaultValue: 'us-west,' }, { defaultValue: null }, { defaultValue: ['us-west'] },
]) {
  test(`refuses invalid multi-select configuration ${JSON.stringify(invalid)} in both manifest readers`, async () => {
    const { state, request } = await serverHarness();
    state.manifest = { ...manifest, storage: undefined, parameters: [{ ...multiselectParameter, ...invalid }] };
    assert.equal(parseAppManifest(state.manifest), undefined);
    const config = await request('get', '/api/designer/config');
    assert.deepEqual(config.body, { manifest: null, runnable: false, notRunnableReason: 'noManifest' });
    assert.equal((await request('post', '/api/designer/run')).status, 409);
    assert.deepEqual(state.submissions, []);
  });
}

test('preserves empty multi-select values through status, history and last-run restoration', async () => {
  const { state, request } = await serverHarness();
  state.manifest = { ...manifest, storage: undefined, parameters: [multiselectParameter] };
  state.runs = [run(10, 'alice', { region: '' })];
  state.listed = [{ run_id: 10, job_id: 100 }];
  const status = await request('get', '/api/designer/run/:jobRunId', { params: { jobRunId: '10' } });
  assert.deepEqual(parseRunSnapshot(status.body).parameters, { region: '' });
  const history = await request('get', '/api/designer/runs');
  assert.deepEqual(history.body.runs[0].parameters, { region: '' });
  const last = await request('get', '/api/designer/last-run');
  assert.equal(last.body.status, 'found');
  const parsed = parseAppManifest(state.manifest);
  assert.deepEqual(initialValuesFor(parsed, last.body.parameters), { region: '' });
});

for (const [recorded, expected] of [
  [undefined, multiselectParameter.defaultValue],
  ['eu-west,us-west', 'eu-west,us-west'],
  [' us-east ', ' us-east '],
  ['obsolete', multiselectParameter.defaultValue],
  ['us-west,obsolete', multiselectParameter.defaultValue],
  ['us-west,', multiselectParameter.defaultValue],
]) {
  test(`restores multi-select value ${JSON.stringify(recorded)} only when it is still offered`, () => {
    const parsed = parseAppManifest({ ...manifest, storage: undefined, parameters: [multiselectParameter] });
    const lastRun = recorded === undefined ? undefined : { region: recorded };
    assert.deepEqual(initialValuesFor(parsed, lastRun), { region: expected });
  });
}

// @ui-test-skill-generated
test('still rejects custom values for a fixed-domain dropdown', async () => {
  const { state, request } = await serverHarness();
  state.manifest = {
    ...manifest, storage: undefined,
    parameters: [{ name: 'region', label: 'Region', type: 'dropdown', defaultValue: 'us-west', choices: ['us-west', 'us-east'] }],
  };
  const response = await request('post', '/api/designer/run', { body: { params: { region: 'custom-value' } } });
  assert.equal(response.status, 400);
  assert.deepEqual(state.submissions, []);
});

test('preserves file-output scopes through the server manifest projection without upload storage', async () => {
  const { state, request } = await serverHarness();
  state.manifest = {
    ...manifest, storage: undefined, parameters: [],
    blocks: [{ ...manifest.blocks[0], fileOutput: { volumes: ['main.default.files'] } }],
  };
  const response = await request('get', '/api/designer/config');
  assert.deepEqual(response.body.manifest.blocks[0].fileOutput, { volumes: ['main.default.files'] });
  assert.equal(response.body.manifest.storage, undefined);
});

test('does not accept a malformed file-output scope from the stored manifest', async () => {
  const { state, request } = await serverHarness();
  state.manifest = {
    ...manifest,
    blocks: [{ ...manifest.blocks[0], fileOutput: { volumes: ['bad/scope'] } }],
  };
  const response = await request('get', '/api/designer/config');
  assert.equal(response.body.manifest, null);
});

test('refuses malformed or duplicate file-output identities before starting an unowned run', async () => {
  const { state, request } = await serverHarness();
  const preview = manifest.blocks[0];
  const file = { type: 'output', id: 'file', nodeId: 'output_0', port: 'result', fileOutput: { volumes: ['main.apps.files'] } };
  for (const blocks of [
    [preview, { ...file, id: undefined }],
    [preview, { ...file, nodeId: undefined }],
    [preview, { ...file, nodeId: '' }],
    [preview, { ...file, id: preview.id }],
    [{ ...file, id: preview.id }, preview],
    [preview, file, file],
  ]) {
    state.manifest = { ...manifest, storage: undefined, parameters: [], blocks };
    assert.equal((await request('post', '/api/designer/run')).status, 409);
    assert.equal((await request('get', '/api/designer/config')).body.manifest, null);
  }
  assert.deepEqual(state.submissions, []);
});

test('file-only runs carry server-owned destination, revision, counts and ownership without upload storage', async () => {
  const { state, request } = await serverHarness();
  state.manifest = {
    ...manifest, storage: undefined, parameters: [],
    blocks: [{ ...manifest.blocks[0], fileOutput: { volumes: ['main.default.files'] } }],
  };
  assert.equal((await request('post', '/api/designer/run')).status, 200);
  const submission = state.submissions[0];
  assert.deepEqual(JSON.parse(submission.notebook_params._lb_file_outputs), { source: { volumes: ['main.default.files'] } });
  assert.equal(submission.notebook_params._lb_collect_row_counts, 'true');
  assert.equal(submission.notebook_params.ld_display_outputs_for, 'source');
  assert.equal(submission.notebook_params._lb_app_viewer, viewerKey('alice', '100'));
  assert.match(submission.notebook_params._lb_app_revision, /^file-outputs-v1:/);
  assert.match(submission.notebook_params._lb_output_namespace, /^[0-9a-f-]{36}$/);
  assert.equal((await request('post', '/api/designer/run', {
    body: { params: { _lb_output_namespace: submission.notebook_params._lb_output_namespace } },
  })).status, 200);
  assert.notEqual(state.submissions[1].notebook_params._lb_output_namespace, submission.notebook_params._lb_output_namespace);
  assert.equal((await request('post', '/api/designer/run', { viewer: '' })).status, 400);
  state.runs = [run(10, 'alice', submission.notebook_params)];
  assert.equal((await request('get', '/api/designer/run/:jobRunId', { viewer: 'bob', params: { jobRunId: '10' } })).status, 404);
});

test('preview-only submissions override any stale writer defaults with an explicit empty policy', async () => {
  const { state, request } = await serverHarness();
  state.manifest = { ...manifest, storage: undefined, parameters: [] };
  const response = await request('post', '/api/designer/run', {
    body: { params: { _lb_file_outputs: '{"hidden_writer":{"volumes":["main.apps.files"]}}' } },
  });
  assert.equal(response.status, 200);
  assert.equal(state.submissions[0].notebook_params._lb_file_outputs, '{}');
  assert.equal(state.submissions[0].notebook_params._lb_collect_row_counts, 'true');
  assert.equal(state.submissions[0].notebook_params._lb_app_viewer, undefined);
});

test('last-run and terminal status include file receipts without table preview or upload storage', async () => {
  const { state, request } = await serverHarness();
  state.manifest = {
    ...manifest, storage: undefined, parameters: [],
    blocks: [{ type: 'output', id: 'written', nodeId: 'output_0', port: 'result', fileOutput: { volumes: ['main.apps.files'] } }],
  };
  const files = [{ path: '/Volumes/main/apps/files/original.xlsx' }];
  for (const behavior of ['run_artifact', 'shared_append', 'shared_workbook_update', undefined]) {
    state.commands = [{ command: 'write_file()', results: { data: [{
      type: 'mimeBundle', data: { 'application/vnd.databricks.lakeflow-designer.files+json': { node: 'output_0', files, behavior } },
    }] } }];
    state.runs = [run(20, 'bob'), run(10, 'alice')];
    state.listed = state.runs.map(({ run_id, job_id }) => ({ run_id, job_id }));
    const last = await request('get', '/api/designer/last-run');
    assert.equal(last.body.status, 'found');
    assert.equal(last.body.run.jobRunId, '10');
    assert.equal(last.body.result.outcome, 'outputs');
    assert.deepEqual(last.body.result.outputs[0].files, files);
    assert.equal(last.body.result.outputs[0].fileBehavior, behavior);
    assert.equal(last.body.result.outputs[0].outcome.outcome, 'missing');
    state.runs[1].state.result_state = 'FAILED';
    const partial = await request('get', '/api/designer/run/:jobRunId', { params: { jobRunId: '10' } });
    const output = parseRunSnapshot(partial.body).result.outputs[0];
    assert.deepEqual(output.files, files);
    assert.equal(output.fileBehavior, behavior);
  }
});

test('enables plugin storage on republish and binds a completed upload to a run', async () => {
  const { state, request } = await serverHarness();
  state.manifest = { ...manifest, version: 6, storage: undefined, parameters: [] };
  assert.equal((await request('post', '/api/designer/run')).status, 200);
  assert.deepEqual(state.apps.map((plugins) => plugins.map(({ name }) => name)), [['server']]);

  state.manifest = manifest;
  const response = await request('post', '/api/designer/uploads/:parameterName', {
    params: { parameterName: 'path' },
    headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'data.json' },
    bytes: Buffer.from('{"value":42}'),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(state.apps.map((plugins) => plugins.map(({ name }) => name)), [['server'], ['files']]);
  assert.equal((await request('post', '/api/designer/run', { body: { params: { path: response.body.upload.reference } } })).status, 200);
  const submitted = state.submissions.at(-1).notebook_params;
  assert.ok(submitted.path.startsWith(`${manifest.storage.path}/uploads/${viewerKey('alice', '100')}/`));
  assert.ok(submitted.path.endsWith(`/${response.body.upload.reference.slice('upload:'.length)}/data.json`));
  assert.equal(submitted.ld_display_outputs_for, 'source');
  assert.equal(submitted._lb_collect_row_counts, 'true');
  assert.equal(submitted._lb_app_viewer, viewerKey('alice', '100'));
  // Only the backend-only instance receives the files plugin: no generic file routes on the HTTP server.
  assert.equal(state.apps.length, 2);
});

test('enforces published file formats at upload and run boundaries', async () => {
  const { state, request } = await serverHarness();
  state.manifest = { ...manifest, parameters: [{ ...manifest.parameters[0], fileFormats: ['excel'] }] };
  const configuration = await request('get', '/api/designer/config');
  assert.deepEqual(configuration.body.manifest.parameters[0].fileFormats, ['excel']);
  const upload = (filename) => request('post', '/api/designer/uploads/:parameterName', {
    params: { parameterName: 'path' },
    headers: { 'content-type': 'application/octet-stream', 'x-file-name': filename },
    bytes: Buffer.from('file contents'),
  });
  const rejected = await upload('data.csv');
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /expects Excel/);
  assert.deepEqual(state.submissions, []);
  const accepted = await upload('data.XLSX');
  assert.equal(accepted.status, 201);
  const params = { path: accepted.body.upload.reference };
  assert.equal((await request('post', '/api/designer/run', { body: { params } })).status, 200);
  state.manifest = { ...manifest, parameters: [{ ...manifest.parameters[0], fileFormats: ['csv'] }] };
  const stale = await request('post', '/api/designer/run', { body: { params } });
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /expects CSV/);
  assert.equal(state.submissions.length, 1);
});

test('denies cross-viewer results and cancellation at the server routes', async () => {
  const { state, request } = await serverHarness();
  state.runs = [run(10, 'bob')];
  for (const [method, path] of [
    ['get', '/api/designer/run/:jobRunId'],
    ['delete', '/api/designer/run/:jobRunId'],
  ]) {
    const response = await request(method, path, { params: { jobRunId: '10' } });
    assert.equal(response.status, 404);
  }
  assert.deepEqual(state.outputReads, []);
  assert.deepEqual(state.cancelled, []);
  const cancel = await request('delete', '/api/designer/run/:jobRunId', { viewer: 'bob', params: { jobRunId: '10' } });
  assert.equal(cancel.status, 200);
  assert.deepEqual(state.cancelled, [10]);
});

test('requires ingress identity and uploaded references, and fails closed on invalid published configuration', async () => {
  const { state, request } = await serverHarness();
  const configured = await request('get', '/api/designer/config');
  assert.equal(configured.body.manifest.version, 6);
  assert.deepEqual(configured.body.manifest.storage, manifest.storage);
  assert.equal(configured.body.manifest.parameters[0].defaultValue, '');
  const missingIdentity = await request('post', '/api/designer/uploads/:parameterName', {
    viewer: '',
    params: { parameterName: 'path' },
  });
  assert.equal(missingIdentity.status, 401);
  const oversized = await request('post', '/api/designer/uploads/:parameterName', {
    params: { parameterName: 'path' },
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(5 * 1024 * 1024 * 1024 + 1),
    },
  });
  assert.equal(oversized.status, 413);
  for (const params of [{}, { path: '/private/author.csv' }]) {
    const response = await request('post', '/api/designer/run', { body: { params } });
    assert.equal(response.status, 400);
  }
  state.manifest = { ...manifest, storage: undefined };
  const invalid = await request('post', '/api/designer/run');
  assert.equal(invalid.status, 409);
  assert.deepEqual(state.submissions, []);
});
