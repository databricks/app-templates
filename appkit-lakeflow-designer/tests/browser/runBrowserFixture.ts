import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { isRecord } from '../../server/plugins/designer/client.ts';

interface BrowserCheckResult {
  completed: boolean;
  checks: Record<string, boolean>;
  error?: string;
}

export async function runBrowserFixture(context: TestContext, fixture: string) {
  const profile = await mkdtemp(path.join(tmpdir(), 'designer-app-browser-'));
  const resources: {
    server?: Awaited<ReturnType<typeof createServer>>;
    browser?: ReturnType<typeof spawn>;
  } = {};
  context.after(async () => {
    const { browser, server } = resources;
    if (browser?.pid !== undefined && browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, 'exit');
      browser.kill();
      await exited;
    }
    await server?.close();
    // Chrome child processes can still flush profile files after the parent exits.
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const forbiddenRequests: string[] = [];
  let reportResult: (result: BrowserCheckResult) => void = () => {};
  let reportFailure: (error: Error) => void = () => {};
  const completed = new Promise<BrowserCheckResult>((resolve, reject) => {
    reportResult = resolve;
    reportFailure = reject;
  });
  const server = (resources.server = await createServer({
    configFile: false,
    root: path.resolve(import.meta.dirname, '../..'),
    // Parallel fixtures must not share optimizer state or reload each other's documents.
    cacheDir: path.join(profile, 'vite-cache'),
    plugins: [
      react(),
      {
        name: 'app-browser-test-routes',
        configureServer(server) {
          server.middlewares.use('/browser-result', (request, response) => {
            void (async () => {
              try {
                let body = '';
                for await (const chunk of request) body += chunk;
                const result: unknown = JSON.parse(body);
                assert.ok(isRecord(result) && typeof result.completed === 'boolean' && isRecord(result.checks));
                const checks: Record<string, boolean> = {};
                for (const [name, passed] of Object.entries(result.checks)) {
                  assert.equal(typeof passed, 'boolean');
                  if (typeof passed === 'boolean') checks[name] = passed;
                }
                reportResult({
                  completed: result.completed,
                  checks,
                  error: typeof result.error === 'string' ? result.error : undefined,
                });
                response.end('ok');
              } catch (error) {
                reportFailure(error instanceof Error ? error : new Error(String(error)));
                response.writeHead(400).end();
              }
            })();
          });
          server.middlewares.use('/navigation-target', (request, response) => {
            forbiddenRequests.push(request.url ?? '');
            response.end('Navigation target must never be requested.');
          });
        },
      },
    ],
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false },
  }));
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  assert.ok(baseUrl, 'The browser test server must be listening.');

  const browser = (resources.browser = spawn(
    process.env.CHROME_BIN || '/usr/bin/google-chrome',
    [
      '--headless',
      // CI containers lack Chrome's process sandbox; the iframe sandbox remains enabled.
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + profile,
      baseUrl + 'tests/browser/' + fixture,
    ],
    { stdio: 'ignore' }
  ));
  browser.once('error', reportFailure);
  browser.once('exit', (code) => reportFailure(new Error('Chrome exited before reporting results: ' + code)));

  const result = await completed;
  for (const [label, passed] of Object.entries(result.checks ?? {})) {
    await context.test(label, () => assert.equal(passed, true));
  }
  assert.equal(result.completed, true, result.error ?? 'The browser fixture did not finish.');
  assert.deepEqual(forbiddenRequests, [], 'Blocked navigations and resources must not reach the server.');
}
