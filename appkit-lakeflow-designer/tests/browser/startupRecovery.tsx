import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from '../../client/src/App';
import { isRecord } from '../../server/plugins/designer/client.ts';

const element = document.getElementById('app');
if (!element) throw new Error('Missing App mount point.');
const root = createRoot(element);
const originalFetch = window.fetch.bind(window);
const stageKey = 'startup-recovery-test:stage';
const navigationKey = 'startup-recovery-test:navigations';
const submissionKey = 'startup-recovery-test:submissions';
const checksKey = 'startup-recovery-test:checks';
const stage = sessionStorage.getItem(stageKey) ?? 'run';
const navigations = Number(sessionStorage.getItem(navigationKey) ?? '0') + 1;
sessionStorage.setItem(navigationKey, String(navigations));
const storedChecks: unknown = JSON.parse(sessionStorage.getItem(checksKey) ?? '{}');
const checks: Record<string, boolean> = isRecord(storedChecks)
  ? Object.fromEntries(
      Object.entries(storedChecks).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    )
  : {};
let configMode: 'ready' | 'starting' | 'invalid' = stage === 'blocked' ? 'starting' : 'ready';
const manifest = {
  version: 8,
  appName: 'Startup recovery',
  parameters: [],
  blocks: [{ type: 'output', id: 'table', label: 'Output', nodeId: 'source', port: 'data' }],
};
const json = (body: unknown) => Promise.resolve(Response.json(body));

// Only the network boundary is controlled; App, Run preparation and browser navigation are real.
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, location.origin);
  if (!url.pathname.startsWith('/api/designer/')) return originalFetch(input, init);
  if (url.pathname.endsWith('/config')) {
    if (configMode === 'starting') {
      return Promise.resolve(
        new Response('<!doctype html><title>App Starting - Databricks</title>', {
          status: 202,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      );
    }
    return json({ manifest: { ...manifest, version: configMode === 'invalid' ? 7 : 8 }, runnable: true });
  }
  if (url.pathname.endsWith('/last-run')) return json({ status: 'none' });
  if (url.pathname.endsWith('/runs')) return json({ status: 'found', runs: [] });
  if (url.pathname.endsWith('/run') && init?.method === 'POST') {
    sessionStorage.setItem(submissionKey, String(Number(sessionStorage.getItem(submissionKey) ?? '0') + 1));
    return json({ jobRunId: '42' });
  }
  if (url.pathname.endsWith('/run/42')) {
    return json({
      jobRunId: '42',
      terminal: true,
      lifeCycleState: 'TERMINATED',
      resultState: 'SUCCESS',
      result: { outcome: 'noPayload', reason: 'Finished without a preview.' },
    });
  }
  throw new Error('Unexpected request: ' + url.pathname);
};

async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 12000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out: ${label}; stage=${stage}; navigations=${navigations}; ${element?.textContent}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const runButton = () =>
  [...document.getElementsByTagName('button')].find((candidate) => candidate.textContent?.trim() === 'Run');
const contains = (text: string) => element?.textContent?.includes(text) === true;
const submissions = () => Number(sessionStorage.getItem(submissionKey) ?? '0');
const saveChecks = () => sessionStorage.setItem(checksKey, JSON.stringify(checks));

async function runChecks() {
  flushSync(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  );
  if (stage === 'run') {
    await waitFor(() => runButton()?.disabled === false, 'ready App');
    sessionStorage.setItem(stageKey, 'blocked');
    configMode = 'starting';
    runButton()?.click();
    await waitFor(() => false, 'automatic reload from Run');
    return;
  }
  if (stage === 'blocked') {
    await waitFor(() => contains('This app could not be loaded'), 'startup error after one reload');
    checks['Run reloads the page without submitting a Job'] = navigations === 2 && submissions() === 0;
    checks['persistent startup stops automatic reloads across navigation'] = contains('Reload the page to reconnect');
    configMode = 'ready';
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => runButton()?.disabled === false, 'configuration recovery');
    checks['a healthy configuration restores Run'] = !contains('Could not refresh');
    saveChecks();
    sessionStorage.setItem(stageKey, 'ready');
    configMode = 'starting';
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => false, 'automatic reload on focus after recovery');
    return;
  }
  if (stage !== 'ready') throw new Error('Unexpected browser-test stage: ' + stage);
  await waitFor(() => runButton()?.disabled === false, 'ready App after wake-up');
  checks['focus can recover from a later idle period after the guard resets'] = navigations === 3;
  checks['reloading never replays the previous Run request'] = submissions() === 0;

  configMode = 'invalid';
  window.dispatchEvent(new Event('focus'));
  await waitFor(() => contains('Could not refresh'), 'invalid configuration error');
  checks['genuine configuration failures remain visible without reloading'] = navigations === 3;
  configMode = 'ready';
  window.dispatchEvent(new Event('focus'));
  await waitFor(() => !contains('Could not refresh') && runButton()?.disabled === false, 'configuration recovery');
  runButton()?.click();
  await waitFor(
    () => contains('Finished without a preview.') && runButton()?.disabled === false,
    'explicit Run after recovery'
  );
  checks['Run works after recovery with exactly one explicit Job submission'] = submissions() === 1;
  flushSync(() => root.unmount());
}

runChecks().then(
  () => originalFetch('/browser-result', { method: 'POST', body: JSON.stringify({ completed: true, checks }) }),
  (error: Error) =>
    originalFetch('/browser-result', {
      method: 'POST',
      body: JSON.stringify({ completed: false, checks, error: error.message }),
    })
);
