import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

interface BrowserCheckResult {
  completed: boolean;
  checks: Record<string, boolean>;
  error?: string;
}

export async function runBrowserFixture(context: TestContext, fixture: string) {
  const profile = await mkdtemp(path.join(tmpdir(), 'designer-app-browser-'));
  const forbiddenRequests: string[] = [];
  let reportResult: (result: BrowserCheckResult) => void = () => {};
  let reportFailure: (error: Error) => void = () => {};
  const completed = new Promise<BrowserCheckResult>((resolve, reject) => {
    reportResult = resolve;
    reportFailure = reject;
  });
  const server = await createServer({
    configFile: false,
    root: path.resolve(import.meta.dirname, '../..'),
    plugins: [react(), {
      name: 'app-browser-test-routes',
      configureServer(server) {
        server.middlewares.use('/browser-result', async (request, response) => {
          try {
            let body = '';
            for await (const chunk of request) body += chunk;
            reportResult(JSON.parse(body));
            response.end('ok');
          } catch (error) {
            reportFailure(error instanceof Error ? error : new Error(String(error)));
            response.writeHead(400).end();
          }
        });
        server.middlewares.use('/navigation-target', (request, response) => {
          forbiddenRequests.push(request.url ?? '');
          response.end('Navigation target must never be requested.');
        });
      },
    }],
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  assert.ok(baseUrl, 'The browser test server must be listening.');

  const browser = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', [
    '--headless',
    // CI containers lack Chrome's process sandbox; the iframe sandbox remains enabled.
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + profile,
    baseUrl + 'tests/browser/' + fixture,
  ], { stdio: 'ignore' });
  browser.once('error', reportFailure);
  browser.once('exit', (code) => reportFailure(new Error('Chrome exited before reporting results: ' + code)));
  context.after(async () => {
    if (browser.pid !== undefined && browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, 'exit');
      browser.kill();
      await exited;
    }
    await server.close();
    await rm(profile, { recursive: true, force: true });
  });

  const result = await completed;
  for (const [label, passed] of Object.entries(result.checks ?? {})) {
    await context.test(label, () => assert.equal(passed, true));
  }
  assert.equal(result.completed, true, result.error ?? 'The browser fixture did not finish.');
  assert.deepEqual(forbiddenRequests, [], 'Blocked navigations and resources must not reach the server.');
}
