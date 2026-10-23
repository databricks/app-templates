import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { OutputHtml } from '../../client/src/OutputHtml';

const output = document.getElementById('output');
const results = document.getElementById('browser-results');
if (!output || !results) throw new Error('Missing browser test elements.');
const root = createRoot(output);
const checks: Record<string, boolean> = {};

async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function wrapperFrame() {
  const frame = output?.getElementsByTagName('iframe').item(0);
  if (!frame) throw new Error('Missing wrapper frame.');
  return frame;
}

function contentFrame() {
  return wrapperFrame().contentDocument?.getElementsByTagName('iframe').item(0);
}

function render(html: string, key = 'output') {
  flushSync(() =>
    root.render(
      <StrictMode>
        <OutputHtml key={key} html={html} title="Report" />
      </StrictMode>
    )
  );
}

async function runChecks() {
  render('<div style="height:720px">Report</div><script>throw new Error("inline-script-marker")</script>');
  await waitFor(() => output?.textContent?.includes('inline-script-marker') === true, 'script error reporting');
  await waitFor(() => Number.parseFloat(wrapperFrame().style.height) >= 720, 'automatic resizing');
  checks['inline scripts run and errors reach the App'] = true;
  checks['output resizes through the wrapper'] = true;
  checks['author content has an opaque origin'] = contentFrame()?.contentDocument === null;
  checks['content keeps the restrictive sandbox'] = contentFrame()?.getAttribute('sandbox') === 'allow-scripts';

  wrapperFrame().contentWindow?.postMessage(
    { type: 'designer-html', error: 'forged-message', height: 1600 },
    location.origin
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  checks['messages from another window are ignored'] =
    !output?.textContent?.includes('forged-message') && Number.parseFloat(wrapperFrame().style.height) < 1600;

  const target = location.origin + '/navigation-target';
  const navigationCases = [
    ['script navigation is blocked', '<script>location.assign(' + JSON.stringify(target + '?script') + ')</script>'],
    [
      'link navigation is blocked',
      '<a id="link" href="' + target + '?link">Link</a>' + '<script>document.getElementById("link").click()</script>',
    ],
    ['meta refresh is blocked', '<meta http-equiv="refresh" content="0;url=' + target + '?refresh">'],
  ];
  for (const [label, html] of navigationCases) {
    render(html);
    await waitFor(() => output?.textContent?.includes('blocked navigation') === true, label);
    checks[label] = true;
  }

  render('<img src="' + target + '?image">');
  await waitFor(
    () => output?.textContent?.includes('security policy blocked a resource') === true,
    'resource restriction'
  );
  checks['external resources remain blocked'] = true;

  render('<script>throw new Error("updated-output-marker")</script>');
  await waitFor(() => output?.textContent?.includes('updated-output-marker') === true, 'updated output');
  checks['new output clears previous errors'] =
    !output?.textContent?.includes('blocked navigation') &&
    !output?.textContent?.includes('security policy blocked a resource');

  render('<script>throw new Error("reload-marker-" + Math.random())</script>');
  await waitFor(() => output?.textContent?.includes('reload-marker-') === true, 'output before reload');
  const previousError = output?.textContent;
  const previousDocument = wrapperFrame().contentDocument;
  wrapperFrame().srcdoc = wrapperFrame().srcdoc;
  await waitFor(
    () =>
      wrapperFrame().contentDocument !== previousDocument &&
      output?.textContent?.includes('reload-marker-') === true &&
      output.textContent !== previousError,
    'wrapper reload'
  );
  checks['a valid wrapper reload restores rendering and messaging'] = true;

  wrapperFrame().srcdoc = '<!doctype html><p>No navigation policy</p>';
  await waitFor(
    () =>
      wrapperFrame().contentDocument?.body.textContent?.includes('No navigation policy') === true && !contentFrame(),
    'wrapper without a policy'
  );
  checks['author content is absent when the wrapper policy is missing'] = true;

  render('<script>throw new Error("new-run-marker")</script>', 'new-run');
  await waitFor(() => output?.textContent?.includes('new-run-marker') === true, 'fresh run');
  checks['a fresh run renders after the previous wrapper is removed'] =
    !output?.textContent?.includes('reload-marker-');

  flushSync(() => root.unmount());
  checks['unmount removes both frames'] = output?.getElementsByTagName('iframe').length === 0;
}

async function reportResult(result: { completed: boolean; checks: Record<string, boolean>; error?: string }) {
  const body = JSON.stringify(result);
  if (results) results.textContent = body;
  await fetch('/browser-result', { method: 'POST', body });
}

runChecks().then(
  () => reportResult({ completed: true, checks }),
  (error: Error) => reportResult({ completed: false, checks, error: error.message })
);
