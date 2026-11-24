import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'tsdown';
import { uploadDownloadRoute } from '../server/plugins/designer/client.ts';

let outputDirectory, FileParameterControl, LastRunLabel;

before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.upload-download-tests-', import.meta.url)));
  await build({
    entry: {
      FileParameterControl: 'client/src/FileParameterControl.tsx',
      LastRunLabel: 'client/src/LastRunLabel.tsx',
    },
    config: false,
    tsconfig: 'tsconfig.client.json',
    outDir: outputDirectory,
    noExternal: [/^@databricks\/appkit-ui(?:\/|$)/],
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  ({ FileParameterControl } = await import(pathToFileURL(join(outputDirectory, 'FileParameterControl.mjs')).href));
  ({ LastRunLabel } = await import(pathToFileURL(join(outputDirectory, 'LastRunLabel.mjs')).href));
});

after(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true });
});

const parameter = { name: 'path', label: 'Input file', type: 'file', defaultValue: '' };

test('keeps file selection controls without a Download action', () => {
  const file = new File(['price\n42\n'], 'sales.csv');
  const props = { name: 'path', error: undefined, onFileChange: () => {}, disabled: false };
  for (const selected of [undefined, file]) {
    const html = renderToStaticMarkup(createElement(FileParameterControl, { ...props, file: selected }));
    assert.doesNotMatch(html, /Download|href=/);
    assert.match(html, selected === undefined ? /Choose file/ : /sales.csv.*Replace/);
  }
});

test('links uploaded filenames in run summaries without making ordinary parameters downloadable', () => {
  const upload = { reference: 'upload:829dcaa7-e505-49c1-b6d0-73d1841e990a', filename: 'sales.csv' };
  const props = {
    run: { jobRunId: '1', endTime: 1000 },
    parameters: { path: upload.reference },
    parameterDisplayValues: { path: upload.filename },
    declared: [parameter],
    variant: 'historical',
  };
  const html = renderToStaticMarkup(createElement(LastRunLabel, props));
  assert.match(html, /Selected run/);
  assert.match(html, /aria-label="Download sales.csv"/);
  const href = /href="([^"]+\/download)"/.exec(html)[1];
  assert.equal(href, uploadDownloadRoute(parameter.name, upload.reference));
  for (const changes of [
    { declared: [] },
    { declared: [{ ...parameter, type: 'text' }] },
    { parameterDisplayValues: undefined },
  ]) {
    assert.doesNotMatch(
      renderToStaticMarkup(createElement(LastRunLabel, { ...props, ...changes })),
      /aria-label="Download/
    );
  }
});
