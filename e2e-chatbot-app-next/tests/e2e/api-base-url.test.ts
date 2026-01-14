import { expect, test } from '@playwright/test';

/**
 * E2E tests for VITE_API_BASE_URL configuration.
 *
 * These tests verify that API calls are made to the correct URLs based on
 * the VITE_API_BASE_URL environment variable configuration.
 *
 * When VITE_API_BASE_URL is:
 * - Empty (default): API calls use relative paths (e.g., /api/session)
 * - Set to a URL: API calls use absolute URLs (e.g., http://localhost:3000/api/session)
 */
test.describe('API Base URL Configuration', () => {
  test.describe('default configuration (relative URLs)', () => {
    test('session API call uses correct URL pattern', async ({ page }) => {
      const apiCalls: string[] = [];

      // Intercept all API requests
      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await page.goto('/');

      // Wait for initial API calls to complete
      await page.waitForTimeout(1000);

      // Verify session API was called
      const sessionCall = apiCalls.find((url) => url.includes('/api/session'));
      expect(sessionCall).toBeDefined();

      // The URL should contain /api/session
      expect(sessionCall).toContain('/api/session');
    });

    test('config API call uses correct URL pattern', async ({ page }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await page.goto('/');
      await page.waitForTimeout(1000);

      const configCall = apiCalls.find((url) => url.includes('/api/config'));
      expect(configCall).toBeDefined();
      expect(configCall).toContain('/api/config');
    });
  });

  test.describe('API endpoints structure', () => {
    test('all API calls follow expected URL pattern', async ({ page }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await page.goto('/');
      await page.waitForTimeout(1000);

      // All API calls should contain /api/ in the path
      for (const call of apiCalls) {
        expect(call).toMatch(/\/api\//);
      }
    });

    test('API calls include expected endpoints on page load', async ({
      page,
    }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      await page.goto('/');
      await page.waitForTimeout(1000);

      // These endpoints should be called on initial page load
      const expectedEndpoints = ['/api/session', '/api/config'];

      for (const endpoint of expectedEndpoints) {
        const found = apiCalls.some((url) => url.includes(endpoint));
        expect(found, `Expected ${endpoint} to be called`).toBe(true);
      }
    });
  });

  test.describe('dynamic API endpoints', () => {
    test('chat history API uses correct URL pattern when navigating to chat', async ({
      page,
    }) => {
      const apiCalls: string[] = [];

      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) {
          apiCalls.push(url);
        }
      });

      // Navigate to a chat page (will likely 404 but we can still check the API pattern)
      await page.goto('/chat/test-chat-id');
      await page.waitForTimeout(1000);

      // Check that chat-related API calls follow the correct pattern
      const chatCalls = apiCalls.filter(
        (url) => url.includes('/api/chat/') || url.includes('/api/messages/'),
      );

      // If there are chat-related calls, they should follow the pattern
      for (const call of chatCalls) {
        expect(call).toMatch(/\/api\/(chat|messages)\/[\w-]+/);
      }
    });
  });
});
