import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'tsdown';
import { parseRunSnapshot } from '../server/plugins/designer/client.ts';

let outputDirectory, ParameterForm, parseAppManifest, initialValuesFor;
before(async () => {
  outputDirectory = await mkdtemp(fileURLToPath(new URL('../.parameter-tests-', import.meta.url)));
  await build({
    entry: {
      ParameterForm: 'client/src/ParameterForm.tsx',
      appConfig: 'client/src/appConfig.ts',
    },
    config: false,
    tsconfig: 'tsconfig.client.json',
    noExternal: [/^@databricks\/appkit-ui(?:\/|$)/],
    outDir: outputDirectory,
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
  ({ ParameterForm } = await import(pathToFileURL(join(outputDirectory, 'ParameterForm.mjs')).href));
  ({ parseAppManifest, initialValuesFor } = await import(pathToFileURL(join(outputDirectory, 'appConfig.mjs')).href));
});
after(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true });
});
const manifest = {
  version: 8,
  appName: 'Parameters',
  parameters: [],
  blocks: [{ type: 'output', id: 'data', label: 'Data', nodeId: 'source', port: 'data' }],
};
const multiselectParameter = {
  name: 'region',
  label: 'Regions',
  type: 'multiselect',
  defaultValue: 'us-west, us-east ',
  choices: ['us-west', ' us-east ', 'eu-west'],
};

for (const choices of [['us-west', 'us-east'], [], undefined, [42]]) {
  test(`projects and renders a published combobox with suggestions ${JSON.stringify(choices)}`, () => {
    const parameter = { name: 'region', label: 'Region', type: 'combobox', defaultValue: 'custom' };
    const published = { ...manifest, storage: undefined, parameters: [{ ...parameter, choices }] };
    const validChoices = Array.isArray(choices) && choices.every((choice) => typeof choice === 'string');
    const expected = { ...parameter, ...(validChoices ? { choices } : {}) };
    const parsed = parseAppManifest(published);
    assert.deepEqual(parsed.parameters, [expected]);

    const html = renderToStaticMarkup(
      createElement(ParameterForm, {
        parameters: parsed.parameters,
        values: {},
        onChange: () => {},
        onRun: () => {},
        running: false,
        runnable: true,
      })
    );
    assert.match(html, /for="region"[^>]*>Region<\/label>/);
    assert.match(html, /<input[^>]*id="region"[^>]*value="custom"/);
    const input = html.match(/<input\b[^>]*id="region"[^>]*>/)?.[0];
    assert.ok(input);
    assert.match(input, /role="combobox"/);
    assert.match(input, /aria-autocomplete="list"/);
    assert.match(input, /aria-expanded="false"/);
    assert.match(html, /<button[^>]*aria-label="Show suggestions for Region"/);
  });
}

for (const defaultValue of [multiselectParameter.defaultValue, '']) {
  test(`projects and renders labelled multi-select choices with default ${JSON.stringify(defaultValue)}`, () => {
    const parameter = { ...multiselectParameter, defaultValue };
    const published = { ...manifest, storage: undefined, parameters: [parameter] };
    const parsed = parseAppManifest(published);
    assert.deepEqual(parsed.parameters, [parameter]);

    const html = renderToStaticMarkup(
      createElement(ParameterForm, {
        parameters: parsed.parameters,
        values: initialValuesFor(parsed),
        onChange: () => {},
        onRun: () => {},
        running: false,
        runnable: true,
      })
    );
    assert.match(html, /role="group" aria-label="Regions"/);
    const labels = new Map(
      [...html.matchAll(/<label\b[^>]*for="([^"]+)"[^>]*>([^<]*)<\/label>/g)].map((match) => [match[1], match[2]])
    );
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

test('restores explicitly empty multi-select values from a run response', () => {
  const parsed = parseAppManifest({ ...manifest, parameters: [multiselectParameter] });
  const snapshot = parseRunSnapshot({
    jobRunId: '42',
    lifeCycleState: 'TERMINATED',
    resultState: 'SUCCESS',
    terminal: true,
    parameters: { region: '' },
  });
  assert.deepEqual(initialValuesFor(parsed, snapshot.parameters), { region: '' });
});
