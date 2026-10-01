import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'tsdown';

let uploads, config, parameters, appConfig, fileFormats, fileUpload, outputDirectory;
before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.upload-tests-', import.meta.url)));
  await build({
    entry: {
      fileUploads: 'server/fileUploads.ts',
      storageConfig: 'shared/storageConfig.ts',
      runParameters: 'server/runParameters.ts',
      appConfig: 'client/src/appConfig.ts',
      fileFormats: 'shared/fileFormats.ts',
      fileUpload: 'client/src/fileUpload.ts',
    },
    config: false,
    tsconfig: 'tsconfig.server.json',
    outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  uploads = await import(pathToFileURL(join(outputDirectory, 'fileUploads.mjs')).href);
  config = await import(pathToFileURL(join(outputDirectory, 'storageConfig.mjs')).href);
  parameters = await import(pathToFileURL(join(outputDirectory, 'runParameters.mjs')).href);
  appConfig = await import(pathToFileURL(join(outputDirectory, 'appConfig.mjs')).href);
  fileFormats = await import(pathToFileURL(join(outputDirectory, 'fileFormats.mjs')).href);
  fileUpload = await import(pathToFileURL(join(outputDirectory, 'fileUpload.mjs')).href);
});
after(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true });
});

const storage = {
  volume: 'main.default.designer_app1',
  path: '/Volumes/main/default/designer_app1/designer_apps/app1',
  maxUploadFileSizeBytes: 5 * 1024 * 1024 * 1024,
};
const fileParameter = { name: 'path', type: 'file', label: 'Data', defaultValue: '/Volumes/private/author.csv' };
const manifest = {
  version: 6,
  appName: 'Uploads',
  storage,
  parameters: [fileParameter],
  blocks: [{ type: 'output', id: 'data', nodeId: 'source', port: 'data', label: 'Data' }],
};

// In-memory UC boundary preserves actual bytes and overwrite behavior; tests exercise the real upload service.
function memoryStore() {
  const files = new Map();
  return {
    files,
    mkdir: async () => {},
    put: async (path, bytes) => {
      assert.equal(files.has(path), false);
      files.set(path, Buffer.from(bytes));
    },
    putStream: async (path, stream) => {
      assert.equal(files.has(path), false);
      files.set(path, Buffer.from(await new Response(stream).arrayBuffer()));
    },
    read: async (path) => {
      if (!files.has(path)) throw new uploads.UploadError(404, 'missing');
      return JSON.parse(files.get(path).toString());
    },
    size: async (path) => files.get(path)?.length,
    delete: async (path) => {
      files.delete(path);
    },
  };
}

test('saves immutable bytes, resolves an upload after service restart, and isolates viewer/parameter/app', async () => {
  const store = memoryStore();
  const alice = uploads.viewerKey('alice', '100');
  const saved = await uploads.saveUpload(store, storage, alice, 'path', 'sales.csv', Buffer.from('a,b\n1,2\n'));
  const resolved = await uploads.resolveUpload({ ...store }, storage, alice, 'path', saved.reference);
  assert.ok(resolved.path.startsWith(`${storage.path}/uploads/${alice}/`));
  assert.equal(resolved.path.slice(storage.path.length + 1).split('/').length, 5);
  assert.equal(store.files.get(resolved.path).toString(), 'a,b\n1,2\n');
  for (const [owner, name, root] of [
    [uploads.viewerKey('bob', '100'), 'path', storage],
    [alice, 'other', storage],
    [uploads.viewerKey('alice', '200'), 'path', storage],
    [alice, 'path', { ...storage, path: storage.path + '2' }],
  ]) {
    await assert.rejects(uploads.resolveUpload(store, root, owner, name, saved.reference), /missing/);
  }
});

test('substitutes only completed owned uploads and stamps ownership for run parameters', async () => {
  const store = memoryStore();
  const owner = uploads.viewerKey('alice', '100');
  const saved = await uploads.saveUpload(store, storage, owner, 'path', 'data.csv', Buffer.from('a\n1\n'));
  const resolved = await parameters.resolveRunParameters(
    manifest,
    {
      path: saved.reference,
      ld_display_outputs_for: 'evil',
      _lb_collect_row_counts: 'false',
      _lb_app_viewer: 'bob',
      target_node: 'evil',
      ignored: 'value',
    },
    owner,
    store,
  );
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.params, {
    _lb_file_outputs: '{}',
    path: (await uploads.resolveUpload(store, storage, owner, 'path', saved.reference)).path,
    ld_display_outputs_for: 'source',
    _lb_collect_row_counts: 'true',
    _lb_app_viewer: owner,
    _lb_app_parameters: JSON.stringify({ path: { label: 'Data', type: 'file', value: 'data.csv' } }),
  });
  for (const value of ['', '/Volumes/main/default/uploads/author.csv', '../../file', 'upload:bad-id']) {
    assert.equal((await parameters.resolveRunParameters(manifest, { path: value }, owner, store)).ok, false);
  }
  assert.equal(
    (await parameters.resolveRunParameters(manifest, { path: saved.reference }, undefined, store)).ok,
    false,
  );
  assert.equal(
    (await parameters.resolveRunParameters(manifest, { path: saved.reference }, uploads.viewerKey('bob', '100'), store))
      .ok,
    false,
  );
  assert.equal(
    (
      await parameters.resolveRunParameters(
        { ...manifest, storage: undefined },
        { path: saved.reference },
        owner,
        store,
      )
    ).ok,
    false,
  );
});

test('never makes incomplete or changed uploads available', async () => {
  const store = memoryStore();
  const owner = uploads.viewerKey('alice', '100');
  const failing = {
    ...store,
    put: async (path, bytes) => {
      if (path.endsWith('.json')) throw new Error('metadata unavailable');
      await store.put(path, bytes);
    },
  };
  await assert.rejects(
    uploads.saveUpload(failing, storage, owner, 'path', 'data.csv', Buffer.from('a\n1\n')),
    /metadata unavailable/,
  );
  assert.equal(store.files.size, 0);
  const saved = await uploads.saveUpload(store, storage, owner, 'path', 'data.csv', Buffer.from('a\n1\n'));
  const { path } = await uploads.resolveUpload(store, storage, owner, 'path', saved.reference);
  store.files.set(path, Buffer.from('changed'));
  await assert.rejects(uploads.resolveUpload(store, storage, owner, 'path', saved.reference), /has changed/);
});

test('streams uploads while enforcing actual byte limits, empty files and interrupted requests', async () => {
  const store = memoryStore();
  const stream = (...chunks) =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
        controller.close();
      },
    });
  const saved = await uploads.saveUploadStream(
    store,
    { ...storage, maxUploadFileSizeBytes: 4 },
    'viewer',
    'path',
    'data.csv',
    stream('ab', 'cd'),
    4,
  );
  assert.equal((await uploads.resolveUpload(store, { ...storage, maxUploadFileSizeBytes: 4 }, 'viewer', 'path', saved.reference)).upload.size, 4);

  await assert.rejects(
    uploads.saveUploadStream(
      store,
      { ...storage, maxUploadFileSizeBytes: 4 },
      'viewer',
      'path',
      'large.csv',
      stream('ab', 'cde'),
    ),
    /5 GB/,
  );
  await assert.rejects(
    uploads.saveUploadStream(store, storage, 'viewer', 'path', 'empty.csv', stream()),
    /non-empty/,
  );
  await assert.rejects(
    uploads.saveUploadStream(
      store,
      storage,
      'viewer',
      'path',
      'interrupted.csv',
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('a'));
          controller.error(new Error('disconnected'));
        },
      }),
    ),
    /disconnected/,
  );
  assert.equal([...store.files.keys()].filter((path) => /large|empty|interrupted/.test(path)).length, 0);
});

test('rejects unsafe filenames and declared sizes', async () => {
  const store = memoryStore();
  for (const filename of ['', ' ', '.', '..', '../data.csv', 'a\\b.csv', 'a\n.csv', 'é'.repeat(128)]) {
    await assert.rejects(uploads.saveUpload(store, storage, 'viewer', 'path', filename, Buffer.from('a')), /valid filename/);
  }
  await assert.rejects(
    uploads.saveUpload(store, { ...storage, maxUploadFileSizeBytes: 1 }, 'viewer', 'path', 'data.csv', Buffer.from('aa')),
    /at most/,
  );
  assert.equal(store.files.size, 0);
});

for (const filename of ['data.csv', 'workbook.xlsx', 'workbook.xls', 'data.json', 'data.parquet', 'data.csv.gz', 'データ.xlsx', 'data']) {
  test(`preserves ${filename}, its bytes and its reference through job parameter resolution`, async () => {
    const store = memoryStore();
    const viewer = uploads.viewerKey('alice', '100');
    const bytes = Buffer.from([0, 1, 127, 128, 255]);
    const saved = await uploads.saveUpload(store, storage, viewer, 'path', filename, bytes);
    const resolved = await uploads.resolveUpload({ ...store }, storage, viewer, 'path', saved.reference);
    assert.ok(resolved.path.endsWith(`/${saved.reference.slice('upload:'.length)}/${filename}`));
    assert.deepEqual(store.files.get(resolved.path), bytes);
    assert.deepEqual(await parameters.resolveRunParameters(manifest, { path: saved.reference }, viewer, store), {
      ok: true,
      params: {
        _lb_file_outputs: '{}',
        path: resolved.path,
        ld_display_outputs_for: 'source',
        _lb_collect_row_counts: 'true',
        _lb_app_viewer: viewer,
        _lb_app_parameters: JSON.stringify({ path: { label: 'Data', type: 'file', value: filename } }),
      },
    });
    assert.equal(store.files.size, 2);
  });
}

test('refuses an upload whose completion record contains an invalid filename', async () => {
  const store = memoryStore();
  const viewer = uploads.viewerKey('alice', '100');
  const saved = await uploads.saveUpload(store, storage, viewer, 'path', 'data.json', Buffer.from('{}'));
  const id = saved.reference.slice('upload:'.length);
  const sidecar = [...store.files.keys()].find((path) => path.endsWith(`/${id}.json`));
  store.files.set(sidecar, Buffer.from(JSON.stringify({ ...saved, filename: '../other.json' })));
  await assert.rejects(uploads.resolveUpload(store, storage, viewer, 'path', saved.reference), /incomplete or unreadable/);
});

test('run ownership protects history, results and cancellation even after upload inputs are removed', () => {
  const alice = uploads.viewerKey('alice', '100');
  const bob = uploads.viewerKey('bob', '100');
  const privateRun = { job_parameters: [{ name: '_lb_app_viewer', value: alice }] };
  for (const privateApp of [true, false]) {
    assert.equal(uploads.canAccessRun(privateRun, alice, privateApp), true);
    assert.equal(uploads.canAccessRun(privateRun, bob, privateApp), false);
    assert.equal(uploads.canAccessRun(privateRun, undefined, privateApp), false);
  }
  assert.equal(uploads.canAccessRun({}, alice, true), false);
  assert.equal(uploads.canAccessRun({}, alice, false), true);
  assert.equal(uploads.viewerKey(undefined, '100'), undefined);
  assert.equal(uploads.viewerKey(' ', '100'), undefined);
});

test('validates versioned storage and never initializes a file input with the author path', () => {
  assert.deepEqual(config.parseAppStorage(storage), storage);
  const shared = { ...storage, volume: 'main.default.shared', path: '/Volumes/main/default/shared/designer_apps/app1' };
  assert.deepEqual(config.parseAppStorage(shared), shared);
  for (const invalid of [
    undefined,
    { ...storage, volume: 'a.b' },
    { ...storage, path: '/Volumes/other/default/uploads/designer_apps/app1' },
    { ...storage, path: storage.path + '/../escape' },
    { ...storage, path: storage.path + '/' },
    { ...shared, path: '/Volumes/main/default/shared' },
    { ...storage, maxUploadFileSizeBytes: 5 * 1024 * 1024 * 1024 + 1 },
  ]) {
    assert.equal(config.parseAppStorage(invalid), undefined);
  }
  const parsed = appConfig.parseAppManifest(manifest);
  assert.equal(parsed.version, 6);
  assert.deepEqual(parsed.storage, storage);
  assert.equal(parsed.parameters[0].defaultValue, '');
  assert.deepEqual(appConfig.initialValuesFor(parsed, { path: '/Volumes/private/file.csv' }), { path: '' });
  assert.deepEqual(appConfig.initialValuesFor(parsed, { path: 'upload:829dcaa7-e505-49c1-b6d0-73d1841e990a' }), {
    path: '',
  });
  for (const version of [3, 4, 5, 7]) {
    assert.equal(appConfig.parseAppManifest({ ...manifest, version }), undefined);
  }
  assert.equal(appConfig.parseAppManifest({ ...manifest, storage: undefined }), undefined);
  const regular = appConfig.parseAppManifest({
    ...manifest,
    version: 6,
    storage: undefined,
    parameters: [{ ...fileParameter, type: 'text' }],
  });
  assert.equal(regular.parameters[0].defaultValue, fileParameter.defaultValue);
  assert.equal(regular.storage, undefined);
  assert.deepEqual(appConfig.parseAppManifest({ ...manifest, parameters: [] }).storage, storage);
  for (const invalid of [null, {}, { ...storage, maxUploadFileSizeBytes: 0 }]) {
    assert.equal(appConfig.parseAppManifest({ ...manifest, storage: invalid, parameters: [] }), undefined);
  }
});

test('ordinary parameters retain defaults and dropdown validation without ownership metadata', async () => {
  const regular = {
    parameters: [{ name: 'choice', label: 'Choice', type: 'dropdown', defaultValue: 'A', choices: ['A', 'B'] }],
  };
  assert.deepEqual(await parameters.resolveRunParameters(regular, {}, undefined, memoryStore()), {
    ok: true,
    params: { choice: 'A', _lb_file_outputs: '{}',
      _lb_app_parameters: JSON.stringify({ choice: { label: 'Choice', type: 'dropdown', value: 'A' } }),
    },
  });
  assert.equal((await parameters.resolveRunParameters(regular, { choice: 'C' }, undefined, memoryStore())).ok, false);
});

test('preview-only and empty selections explicitly clear inherited file-output Job policies', async () => {
  const stalePolicy = JSON.stringify({ output_0: { volumes: ['main.apps.files'] } });
  for (const blocks of [undefined, [], [manifest.blocks[0]]]) {
    const resolved = await parameters.resolveRunParameters(
      { parameters: [], blocks },
      { _lb_file_outputs: stalePolicy },
      undefined,
      memoryStore(),
    );
    assert.equal(resolved.ok, true);
    assert.equal(resolved.params._lb_file_outputs, '{}');
    assert.equal(resolved.params._lb_app_viewer, undefined);
    // Jobs may merge request overrides with defaults from a newer, partially published runner.
    const effectiveParams = { _lb_file_outputs: stalePolicy, ...resolved.params };
    assert.deepEqual(JSON.parse(effectiveParams._lb_file_outputs), {});
    if (blocks?.length) assert.equal(resolved.params._lb_collect_row_counts, 'true');
  }
});

test('file-output manifest scopes are explicit without requiring upload storage', async () => {
  const fileManifest = {
    ...manifest, storage: undefined, parameters: [],
    blocks: [{ ...manifest.blocks[0], fileOutput: { volumes: ['main.default.files', 'main.default.other'] } }],
  };
  const parsed = appConfig.parseAppManifest(fileManifest);
  assert.deepEqual(parsed.blocks[0].fileOutput, fileManifest.blocks[0].fileOutput);
  assert.equal(parsed.storage, undefined);
  for (const fileOutput of [null, {}, { volumes: [] }, { volumes: ['bad'] }, { volumes: ['main.default.files/..'] }]) {
    assert.equal(appConfig.parseAppManifest({ ...fileManifest, blocks: [{ ...fileManifest.blocks[0], fileOutput }] }), undefined);
  }
  const resolved = await parameters.resolveRunParameters(fileManifest, {
    _lb_file_outputs: JSON.stringify({ source: { volumes: ['main.private.secret'] } }),
    _lb_collect_row_counts: 'false', _lb_app_viewer: 'attacker',
  }, 'viewer', memoryStore());
  assert.equal(resolved.ok, true);
  assert.deepEqual(JSON.parse(resolved.params._lb_file_outputs), { source: fileManifest.blocks[0].fileOutput });
  assert.equal(resolved.params._lb_collect_row_counts, 'true');
  assert.equal(resolved.params._lb_app_viewer, 'viewer');
  assert.equal((await parameters.resolveRunParameters(fileManifest, {}, undefined, memoryStore())).ok, false);
});

test('each submitted file-output run gets a fresh server-owned namespace, never a consumer value', async () => {
  const submittedNamespace = '00000000-0000-4000-8000-000000000000';
  const fileManifest = {
    parameters: [{ name: '_lb_output_namespace', label: 'Reserved', type: 'text', defaultValue: submittedNamespace }],
    blocks: [{ type: 'output', nodeId: 'output_0', fileOutput: { volumes: ['main.apps.files'] } }],
  };
  assert.equal(parameters.isReservedParameter('_lb_output_namespace'), true);
  const namespaces = [];
  for (const viewer of ['alice', 'alice', 'bob']) {
    const resolved = await parameters.resolveRunParameters(fileManifest, {
      _lb_output_namespace: submittedNamespace,
    }, viewer, memoryStore());
    assert.equal(resolved.ok, true);
    const namespace = resolved.params._lb_output_namespace;
    assert.match(namespace, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(namespace, submittedNamespace);
    namespaces.push(namespace);
  }
  assert.equal(new Set(namespaces).size, namespaces.length);
  const previewOnly = await parameters.resolveRunParameters({ ...fileManifest, blocks: [] }, {
    _lb_output_namespace: submittedNamespace,
  }, 'alice', memoryStore());
  assert.equal(previewOnly.ok, true);
  assert.equal(previewOnly.params._lb_output_namespace, undefined);
});

test('malformed file-output identities cannot silently downgrade an App to preview-only behavior', () => {
  const preview = manifest.blocks[0];
  const file = { type: 'output', id: 'file', nodeId: 'output_0', port: 'result', fileOutput: { volumes: ['main.apps.files'] } };
  for (const blocks of [
    [preview, { ...file, id: undefined }],
    [preview, { ...file, id: '' }],
    [preview, { ...file, id: ' ' }],
    [preview, { ...file, nodeId: undefined }],
    [preview, { ...file, nodeId: '' }],
    [preview, { ...file, id: preview.id }],
    [{ ...file, id: preview.id }, preview],
    [preview, file, file],
    [preview, { ...file, type: 'markdown', text: 'Not a file output' }],
  ]) {
    assert.equal(appConfig.parseAppManifest({ ...manifest, storage: undefined, parameters: [], blocks }), undefined);
  }
  const ordinary = appConfig.parseAppManifest({
    ...manifest, storage: undefined, parameters: [], blocks: [preview, { ...preview, id: '' }, preview],
  });
  assert.equal(ordinary.blocks.length, 1);
});

test('rejects mismatched uploads before network transfer, including drag-and-drop selections', async () => {
  const csv = new File(['a,b\n1,2\n'], 'data.csv');
  assert.match(fileUpload.validateUpload(csv, ['excel']), /expects Excel/);
  await assert.rejects(fileUpload.uploadFile('path', csv, ['excel']), /expects Excel/);
  assert.equal(fileUpload.validateUpload(csv, ['csv']), undefined);
  assert.match(fileUpload.validateUpload(new File([], 'empty.xlsx'), ['excel']), /non-empty/);
  assert.equal(fileFormats.uploadAccept(['excel']), '.xls,.xlsx');
});

test('validates supported extensions case-insensitively without inferring formats or trusting MIME types', () => {
  for (const [format, filename] of [
    ['excel', 'DATA.XLSX'], ['excel', 'legacy.xls'], ['csv', 'data.tsv'], ['csv', 'data.CSV.GZ'],
    ['json', 'data.jsonl'], ['json', 'data.ndjson.bz2'], ['parquet', 'part.parquet'],
    ['avro', 'part.avro'], ['orc', 'part.orc'], ['xml', 'data.xml'], ['pdf', 'data.pdf'],
  ]) assert.equal(fileFormats.validateFileFormat(filename, [format]), undefined);
  for (const filename of ['data.csv', 'data.xlsx.csv', 'data', 'data.xlsx.gz'])
    assert.match(fileFormats.validateFileFormat(filename, ['excel']), /expects Excel/);
  assert.match(fileFormats.validateFileFormat('data.xlsx', ['csv']), /expects CSV/);
  assert.match(fileUpload.validateUpload(new File(['a'], 'data.csv', { type: 'application/vnd.ms-excel' }), ['excel']), /expects Excel/);
  for (const formats of [undefined, [], ['text'], ['binaryfile'], ['custom.provider'], ['constructor']]) {
    assert.equal(fileFormats.validateFileFormat('no-extension', formats), undefined);
    assert.equal(fileFormats.uploadAccept(formats), undefined);
  }
  assert.match(fileFormats.validateFileFormat('data.csv', ['csv', 'excel']), /expects Excel/);
  assert.equal(fileFormats.uploadAccept(['csv', 'text']), fileFormats.uploadAccept(['csv']));
  assert.equal(fileFormats.uploadAccept(['csv', 'excel']), undefined);
});

test('preserves file format constraints through the browser manifest and rejects malformed metadata', () => {
  const configured = { ...manifest, parameters: [{ ...fileParameter, fileFormats: ['excel'] }] };
  assert.deepEqual(appConfig.parseAppManifest(configured).parameters[0].fileFormats, ['excel']);
  for (const invalid of ['excel', null, [1], [''], ['EXCEL']]) {
    assert.equal(appConfig.parseAppManifest({ ...manifest, parameters: [{ ...fileParameter, fileFormats: invalid }] }), undefined);
  }
});

test('rechecks retained uploads against the current publication before starting a run', async () => {
  const store = memoryStore();
  const owner = uploads.viewerKey('alice', '100');
  const saved = await uploads.saveUpload(store, storage, owner, 'path', 'data.csv', Buffer.from('a\n1\n'));
  const result = await parameters.resolveRunParameters(
    { ...manifest, parameters: [{ ...fileParameter, fileFormats: ['excel'] }] },
    { path: saved.reference }, owner, store,
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /expects Excel/);
});
