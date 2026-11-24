import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { App } from '../../client/src/App';

const element = document.getElementById('app');
if (!element) throw new Error('Missing App mount point.');
const root = createRoot(element);
const checks: Record<string, boolean> = {};
const originalFetch = window.fetch.bind(window);
let submissions = 0;
let cancellations = 0;
let pollState: 'unavailable' | 'unreadable' | 'running' | 'complete' | 'malformed-result' = 'unavailable';
let missingSubmissionId = false;
let followExistingRun = false;
let updating = false;
let unavailableConfigReads = 0;
let continuedLastRun = false;
let continuedHistory = false;
const manifest = {
  version: 8,
  appName: 'Run lifecycle test',
  parameters: [],
  blocks: [{ type: 'output', id: 'table', label: 'Output', nodeId: 'source', port: 'data' }],
};
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const malformedResult = {
  outcome: 'outputs',
  outputs: [
    {
      id: 'table',
      title: 'Output',
      outcome: { outcome: 'result', payload: { target_node: 'source', target_port: 'data', rows: [] } },
    },
  ],
};

// Network failures are controlled at the fetch boundary; the complete App and its hooks run in Chrome.
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, location.origin);
  if (!url.pathname.startsWith('/api/designer/')) return originalFetch(input, init);
  if (url.pathname.endsWith('/config')) {
    if (unavailableConfigReads > 0) {
      unavailableConfigReads -= 1;
      return json({}, 503);
    }
    return json({ manifest, runnable: !updating, ...(updating ? { notRunnableReason: 'updating' } : {}) });
  }
  if (url.pathname.endsWith('/last-run')) {
    if (followExistingRun) return json({ status: 'none', active: { run: { jobRunId: '77' } } });
    if (!url.searchParams.has('cursor')) return json({ status: 'searching', nextPageToken: 'older' });
    continuedLastRun = true;
    return json({ status: 'none' });
  }
  if (url.pathname.endsWith('/runs')) {
    if (!url.searchParams.has('cursor')) return json({ status: 'found', runs: [], nextPageToken: 'older' });
    continuedHistory = true;
    return json({ status: 'found', runs: [{ jobRunId: '99', resultState: 'SUCCESS' }] });
  }
  if (url.pathname.endsWith('/run') && init?.method === 'POST') {
    submissions += 1;
    return json(missingSubmissionId ? {} : { jobRunId: '42' });
  }
  if (url.pathname.endsWith('/run/77')) {
    return json({ jobRunId: '77', terminal: true, resultState: 'SUCCESS', result: malformedResult });
  }
  if (url.pathname.endsWith('/run/42')) {
    if (init?.method === 'DELETE') {
      cancellations += 1;
      return cancellations === 1 ? json({ error: 'Cancellation service unavailable' }, 503) : json({ cancelled: true });
    }
    if (pollState === 'unavailable') return json({}, 503);
    if (pollState === 'unreadable') return json({ terminal: true });
    if (pollState === 'malformed-result') {
      return json({ jobRunId: '42', terminal: true, resultState: 'SUCCESS', result: malformedResult });
    }
    return json({
      jobRunId: '42',
      terminal: pollState === 'complete',
      lifeCycleState: pollState === 'complete' ? 'TERMINATED' : 'RUNNING',
      runPageUrl: 'https://workspace.test/jobs/10/runs/42',
      ...(pollState === 'complete'
        ? {
            resultState: 'SUCCESS',
            result: { outcome: 'noPayload', reason: 'Finished without a preview.' },
          }
        : {}),
    });
  }
  return json({ error: 'Unexpected request: ' + url.pathname }, 404);
};

async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 12000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const button = (label: string) =>
  [...document.getElementsByTagName('button')].find((candidate) => candidate.textContent?.trim() === label);
const contains = (text: string) => element?.textContent?.includes(text) === true;
const hasJobLink = () => [...document.getElementsByTagName('a')].some((link) => link.href.includes('/jobs/'));

async function runChecks() {
  flushSync(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  );
  await waitFor(() => button('Run')?.disabled === false && continuedLastRun, 'ready App and paged last-run search');
  checks['last-run search follows a continuation past other viewers'] = true;
  await waitFor(() => button('Load older runs') !== undefined, 'history continuation');
  button('Load older runs')?.click();
  await waitFor(() => continuedHistory && button('Load older runs') === undefined, 'older history page');
  checks['empty history pages retain a working load-older control'] = true;

  button('Run')?.click();
  await waitFor(() => submissions === 1 && contains('Status is temporarily unavailable'), 'poll failure');
  checks['a status error retains the accepted run and disables another submission'] =
    button('Running…')?.disabled === true;
  button('Cancel')?.click();
  await waitFor(
    () => contains('Cancellation could not be confirmed') && button('Cancel')?.disabled === false,
    'cancel retry'
  );
  checks['a failed cancellation remains visible and can be retried'] = cancellations === 1;
  button('Cancel')?.click();
  await waitFor(() => cancellations === 2 && button('Cancelling…')?.disabled === true, 'accepted cancellation');
  pollState = 'unreadable';
  await waitFor(() => contains('The server returned an unreadable run status.'), 'malformed status response');
  checks['an unreadable status cannot settle an accepted run or enable another submission'] =
    button('Running…')?.disabled === true && submissions === 1;
  pollState = 'running';
  await waitFor(() => !contains('Status is temporarily unavailable') && contains('Running…'), 'status recovery');
  checks['polling resumes without submitting another Job'] = submissions === 1;
  checks['active runs expose no direct Job links'] = !hasJobLink();
  pollState = 'complete';
  await waitFor(() => button('Run')?.disabled === false && contains('Finished without a preview.'), 'terminal result');
  checks['only a terminal run enables another submission'] = true;
  checks['completed runs expose no direct Job links'] = !hasJobLink();

  pollState = 'malformed-result';
  button('Run')?.click();
  await waitFor(
    () => button('Run')?.disabled === false && contains('This output reported success but its payload was unreadable.'),
    'malformed terminal result'
  );
  checks['a malformed result from a submitted run renders a readable diagnostic'] = submissions === 2;

  missingSubmissionId = true;
  button('Run')?.click();
  await waitFor(() => contains('Check run history before trying again.'), 'missing accepted run ID');
  checks['a submission without a run ID reports uncertainty instead of polling an undefined run'] =
    button('Run')?.disabled === false && submissions === 3;

  updating = true;
  window.dispatchEvent(new Event('focus'));
  await waitFor(() => contains('This App is updating') && button('Run')?.disabled === true, 'republish pause');
  updating = false;
  unavailableConfigReads = 1;
  await waitFor(
    () => !contains('This App is updating') && button('Run')?.disabled === false,
    'republish recovery after read failure'
  );
  checks['republish pauses submissions and recovers through a temporary configuration error'] =
    !contains('Could not refresh');

  followExistingRun = true;
  flushSync(() => root.render(null));
  flushSync(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  );
  await waitFor(
    () => contains('This output reported success but its payload was unreadable.'),
    'malformed result from a followed run'
  );
  checks['a malformed result from a followed run uses the same readable diagnostic'] = submissions === 3;
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
