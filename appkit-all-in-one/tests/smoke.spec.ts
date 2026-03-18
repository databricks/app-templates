import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Templated configuration (resolved by `databricks apps init`) ────────────
const APP_CONFIG = {
  name: 'appkit-all-in-one',
  plugins: [
    'analytics',
    'lakebase',
    'genie',
  ],
} as const;

interface PluginPage {
  navLabel: string;
  path: string;
  expectedTexts: string[];
}

const PLUGIN_PAGES: Record<string, PluginPage> = {
  analytics: {
    navLabel: 'Analytics',
    path: '/analytics',
    expectedTexts: ['SQL Query Result', 'Sales Data Filter'],
  },
  lakebase: {
    navLabel: 'Lakebase',
    path: '/lakebase',
    expectedTexts: ['Todo List'],
  },
  genie: {
    navLabel: 'Genie',
    path: '/genie',
    expectedTexts: ['Ask questions about your data using Databricks AI/BI Genie'],
  },
};

const enabledPages = Object.entries(PLUGIN_PAGES).filter(
  ([key]) => APP_CONFIG.plugins.includes(key),
);

// ── Tests ───────────────────────────────────────────────────────────────────

let testArtifactsDir: string;
let consoleLogs: string[] = [];
let consoleErrors: string[] = [];
let pageErrors: string[] = [];
let failedRequests: string[] = [];

test('smoke test - app loads and displays home page', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: APP_CONFIG.name })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Welcome to your Databricks App' }),
  ).toBeVisible();
  await expect(page.getByText('Getting Started')).toBeVisible();

  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  for (const [, plugin] of enabledPages) {
    await expect(page.getByRole('link', { name: plugin.navLabel })).toBeVisible();
  }
});

for (const [name, plugin] of enabledPages) {
  test(`smoke test - ${name} page loads`, async ({ page }) => {
    await page.goto(plugin.path);

    for (const text of plugin.expectedTexts) {
      await expect(page.getByText(text)).toBeVisible();
    }
  });
}

// ── Lifecycle hooks ─────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  consoleLogs = [];
  consoleErrors = [];
  pageErrors = [];
  failedRequests = [];

  // Create temp directory for test artifacts
  testArtifactsDir = join(process.cwd(), '.smoke-test');
  mkdirSync(testArtifactsDir, { recursive: true });

  // Capture console logs and errors (including React errors)
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();

    // Skip empty lines and formatting placeholders
    if (!text.trim() || /^%[osd]$/.test(text.trim())) {
      return;
    }

    // Get stack trace for errors if available
    const location = msg.location();
    const locationStr = location.url ? ` at ${location.url}:${location.lineNumber}:${location.columnNumber}` : '';

    consoleLogs.push(`[${type}] ${text}${locationStr}`);

    // Separately track error messages (React errors appear here)
    if (type === 'error') {
      consoleErrors.push(`${text}${locationStr}`);
    }
  });

  // Capture page errors with full stack trace
  page.on('pageerror', (error) => {
    const errorDetails = `Page error: ${error.message}\nStack: ${error.stack || 'No stack trace available'}`;
    pageErrors.push(errorDetails);
    // Also log to console for immediate visibility
    console.error('Page error detected:', errorDetails);
  });

  // Capture failed requests
  page.on('requestfailed', (request) => {
    failedRequests.push(`Failed request: ${request.url()} - ${request.failure()?.errorText}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const testName = testInfo.title.replace(/ /g, '-').toLowerCase();
  // Always capture artifacts, even if test fails
  const screenshotPath = join(testArtifactsDir, `${testName}-app-screenshot.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const logsPath = join(testArtifactsDir, `${testName}-console-logs.txt`);
  const allLogs = [
    '=== Console Logs ===',
    ...consoleLogs,
    '\n=== Console Errors (React errors) ===',
    ...consoleErrors,
    '\n=== Page Errors ===',
    ...pageErrors,
    '\n=== Failed Requests ===',
    ...failedRequests,
  ];
  writeFileSync(logsPath, allLogs.join('\n'), 'utf-8');

  console.log(`Screenshot saved to: ${screenshotPath}`);
  console.log(`Console logs saved to: ${logsPath}`);
  if (consoleErrors.length > 0) {
    console.log('Console errors detected:', consoleErrors);
  }
  if (pageErrors.length > 0) {
    console.log('Page errors detected:', pageErrors);
  }
  if (failedRequests.length > 0) {
    console.log('Failed requests detected:', failedRequests);
  }

  await page.close();
});
