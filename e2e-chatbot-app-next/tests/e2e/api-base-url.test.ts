import { expect, test, type Page } from '@playwright/test';

/**
 * E2E tests for VITE_API_BASE_URL configuration.
 *
 * These tests verify that API calls are made to the correct URLs based on
 * the VITE_API_BASE_URL environment variable configuration.
 *
 * When VITE_API_BASE_URL is:
 * - Empty (default): API calls use relative paths (e.g., /api/session)
 * - Set to a URL: API calls use absolute URLs (e.g., http://localhost:3000/api/session)
 *
 * To test with absolute URLs:
 *   VITE_API_BASE_URL=http://localhost:3000 npm run build:client
 *   VITE_API_BASE_URL=http://localhost:3000 TEST_MODE=ephemeral npx playwright test tests/e2e/api-base-url.test.ts
 */

// Get the configured API base URL from environment
// This should match what was used during the client build
const API_BASE_URL = process.env.VITE_API_BASE_URL || '';
const isAbsoluteUrlMode = API_BASE_URL !== '';

/**
 * Helper to navigate to a page and wait for initial API calls to complete.
 * This replaces arbitrary waitForTimeout with proper request/response waiting.
 */
async function gotoAndWaitForApi(
  page: Page,
  path: string,
  expectedEndpoints: string[] = ['/api/session', '/api/config'],
): Promise<void> {
  const responsePromises = expectedEndpoints.map((endpoint) =>
    page.waitForResponse(
      (response) => response.url().includes(endpoint),
      { timeout: 10000 },
    ),
  );

  await Promise.all([page.goto(path), ...responsePromises]);
}

test.describe('API Base URL Configuration', () => {
  test.beforeEach(async () => {
    console.log(
      `[API Base URL Test] Mode: ${isAbsoluteUrlMode ? 'absolute' : 'relative'}`,
    );
    if (isAbsoluteUrlMode) {
      console.log(`[API Base URL Test] Base URL: ${API_BASE_URL}`);
    }
  });

  test.describe('API call URL patterns', () => {
    test('session API call uses correct URL pattern', async ({ page }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await gotoAndWaitForApi(page, '/');

      const sessionCall = apiCalls.find((url) => url.includes('/api/session'));
      expect(sessionCall).toBeDefined();

      if (isAbsoluteUrlMode) {
        // Should be an absolute URL starting with the configured base
        expect(sessionCall).toMatch(new RegExp(`^${API_BASE_URL}/api/session`));
      } else {
        // Should be a relative URL (resolved to the page's origin)
        expect(sessionCall).toContain('/api/session');
      }
    });

    test('config API call uses correct URL pattern', async ({ page }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await gotoAndWaitForApi(page, '/');

      const configCall = apiCalls.find((url) => url.includes('/api/config'));
      expect(configCall).toBeDefined();

      if (isAbsoluteUrlMode) {
        expect(configCall).toMatch(new RegExp(`^${API_BASE_URL}/api/config`));
      } else {
        expect(configCall).toContain('/api/config');
      }
    });

    test('all API calls use consistent URL pattern', async ({ page }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await gotoAndWaitForApi(page, '/');

      expect(apiCalls.length).toBeGreaterThan(0);

      for (const call of apiCalls) {
        if (isAbsoluteUrlMode) {
          // All API calls should start with the configured base URL
          expect(
            call.startsWith(API_BASE_URL),
            `Expected ${call} to start with ${API_BASE_URL}`,
          ).toBe(true);
        }
        // All API calls should contain /api/
        expect(call).toMatch(/\/api\//);
      }
    });
  });

  test.describe('expected endpoints on page load', () => {
    test('calls session and config endpoints', async ({ page }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await gotoAndWaitForApi(page, '/');

      const expectedEndpoints = ['/api/session', '/api/config'];

      for (const endpoint of expectedEndpoints) {
        const found = apiCalls.some((url) => url.includes(endpoint));
        expect(found, `Expected ${endpoint} to be called`).toBe(true);
      }
    });
  });

  test.describe('dynamic API endpoints', () => {
    test('chat-related API calls use correct URL pattern', async ({ page }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      // Navigate to a chat page - wait for chat and messages endpoints
      await gotoAndWaitForApi(page, '/chat/test-chat-id', [
        '/api/session',
        '/api/config',
        '/api/chat/test-chat-id',
      ]);

      const chatCalls = apiCalls.filter(
        (url) => url.includes('/api/chat/') || url.includes('/api/messages/'),
      );

      for (const call of chatCalls) {
        if (isAbsoluteUrlMode) {
          expect(
            call.startsWith(API_BASE_URL),
            `Expected ${call} to start with ${API_BASE_URL}`,
          ).toBe(true);
        }
        expect(call).toMatch(/\/api\/(chat|messages)\/[\w-]+/);
      }
    });
  });

  // This test only makes sense when absolute URLs are configured
  test.describe('absolute URL mode specific', () => {
    test.skip(!isAbsoluteUrlMode, 'Only runs when VITE_API_BASE_URL is set');

    test('API calls go to different origin than page', async ({
      page,
      baseURL,
    }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await gotoAndWaitForApi(page, '/');

      // When using absolute URLs, API calls should go to API_BASE_URL
      // which may be different from the page's baseURL
      for (const call of apiCalls) {
        expect(call.startsWith(API_BASE_URL)).toBe(true);
        // If API_BASE_URL is different from baseURL, verify they don't match
        if (API_BASE_URL !== baseURL) {
          expect(call.startsWith(baseURL!)).toBe(false);
        }
      }
    });
  });

  // This test only makes sense when relative URLs are used
  test.describe('relative URL mode specific', () => {
    test.skip(isAbsoluteUrlMode, 'Only runs when VITE_API_BASE_URL is empty');

    test('API calls go to same origin as page', async ({ page, baseURL }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await gotoAndWaitForApi(page, '/');

      // When using relative URLs, API calls should go to the page's origin
      for (const call of apiCalls) {
        expect(
          call.startsWith(baseURL!),
          `Expected ${call} to start with ${baseURL}`,
        ).toBe(true);
      }
    });
  });
});
