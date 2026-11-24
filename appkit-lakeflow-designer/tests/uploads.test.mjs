import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'tsdown';
import * as config from '../server/plugins/designer/client.ts';

let appConfig, fileUpload, outputDirectory;

before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.upload-tests-', import.meta.url)));
  await build({
    entry: {
      appConfig: 'client/src/appConfig.ts',
      fileUpload: 'client/src/fileUpload.ts',
    },
    config: false,
    tsconfig: 'tsconfig.server.json',
    outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  appConfig = await import(pathToFileURL(join(outputDirectory, 'appConfig.mjs')).href);
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
  version: 8,
  appName: 'Uploads',
  storage,
  parameters: [fileParameter],
  blocks: [{ type: 'output', id: 'data', nodeId: 'source', port: 'data', label: 'Data' }],
};

test('configuration refresh clears file references across switches and preserves only valid non-file values', () => {
  const previous = {
    ...manifest,
    parameters: [
      fileParameter,
      { name: 'text', type: 'text', label: 'Text', defaultValue: 'default' },
      { name: 'choice', type: 'dropdown', label: 'Choice', defaultValue: 'east', choices: ['east', 'west'] },
      { name: 'regions', type: 'multiselect', label: 'Regions', defaultValue: 'east', choices: ['east', 'west'] },
    ],
  };
  const values = { path: 'upload:cached', text: '', choice: 'west', regions: 'east,west', removed: 'discard' };
  const next = {
    ...previous,
    storage: { ...storage, volume: 'main.default.other', path: '/Volumes/main/default/other/designer_apps/app1' },
    parameters: previous.parameters.map((parameter) =>
      parameter.name === 'choice' ? { ...parameter, choices: ['east'] } : parameter
    ),
  };
  assert.notEqual(appConfig.uploadConfigurationKey(previous), appConfig.uploadConfigurationKey(next));
  assert.equal(
    appConfig.uploadConfigurationKey(previous),
    appConfig.uploadConfigurationKey({ ...previous, appName: 'Renamed' })
  );
  assert.deepEqual(appConfig.refreshedValuesFor(previous, next, values), {
    path: '',
    text: '',
    choice: 'east',
    regions: 'east,west',
  });
  assert.equal(
    appConfig.refreshedValuesFor(previous, { ...previous, appName: 'Renamed' }, values).path,
    'upload:cached'
  );
  assert.equal(appConfig.refreshedValuesFor(next, previous, { ...values, path: '' }).path, '');
});

test('upload caches reuse unchanged files and discard late completions after invalidation', async () => {
  const reference = 'upload:829dcaa7-e505-49c1-b6d0-73d1841e990a';
  const response = () => new Response(JSON.stringify({ upload: { reference, filename: 'data.csv' } }));
  const pending = Promise.withResolvers();
  const request = mock.method(globalThis, 'fetch', async () => response());
  try {
    const file = new File(['data'], 'data.csv');
    const cache = fileUpload.createFileUploadCache();
    assert.equal(await cache.upload('path', file), reference);
    assert.equal(await cache.upload('path', file), reference);
    assert.equal(request.mock.callCount(), 1);
    request.mock.mockImplementation(() => pending.promise);
    const late = cache.upload('other', file);
    const refused = assert.rejects(late, { name: 'AbortError' });
    cache.dispose();
    assert.equal(request.mock.calls.at(-1).arguments[1].signal.aborted, true);
    pending.resolve(response());
    await refused;
    await assert.rejects(cache.upload('path', file), { name: 'AbortError' });
    request.mock.mockImplementation(async () => response());
    const fresh = fileUpload.createFileUploadCache();
    assert.equal(await fresh.upload('path', file), reference);
    assert.equal(request.mock.callCount(), 3);
    fresh.dispose();
  } finally {
    request.mock.restore();
  }
});

test('upload failures expose a recognizable re-upload error to the form', async () => {
  const request = mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: 'Upload the file again.',
          code: 'UPLOAD_UNAVAILABLE',
        }),
        { status: 409 }
      )
  );
  try {
    await assert.rejects(fileUpload.uploadFile('path', new File(['a'], 'data.csv')), fileUpload.UploadUnavailableError);
    assert.equal(request.mock.callCount(), 1);
  } finally {
    request.mock.restore();
  }
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
  assert.equal(parsed.version, 8);
  assert.deepEqual(parsed.storage, storage);
  assert.equal(parsed.parameters[0].defaultValue, '');
  assert.deepEqual(appConfig.initialValuesFor(parsed, { path: '/Volumes/private/file.csv' }), { path: '' });
  assert.deepEqual(appConfig.initialValuesFor(parsed, { path: 'upload:829dcaa7-e505-49c1-b6d0-73d1841e990a' }), {
    path: '',
  });
  for (const version of [3, 4, 5, 6, 7, 9]) {
    assert.equal(appConfig.parseAppManifest({ ...manifest, version }), undefined);
  }
  assert.equal(appConfig.parseAppManifest({ ...manifest, storage: undefined }), undefined);
  const regular = appConfig.parseAppManifest({
    ...manifest,
    version: 8,
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

test('rejects mismatched uploads before network transfer, including drag-and-drop selections', async () => {
  const csv = new File(['a,b\n1,2\n'], 'data.csv');
  assert.match(fileUpload.validateUpload(csv, ['excel']), /expects Excel/);
  await assert.rejects(fileUpload.uploadFile('path', csv, ['excel']), /expects Excel/);
  assert.equal(fileUpload.validateUpload(csv, ['csv']), undefined);
  assert.match(fileUpload.validateUpload(new File([], 'empty.xlsx'), ['excel']), /non-empty/);
  assert.match(
    fileUpload.validateUpload(new File(['a'], 'data.csv', { type: 'application/vnd.ms-excel' }), ['excel']),
    /expects Excel/
  );
});
