import { test, expect } from '../fixtures';

test.describe('OBO Scope Banner', () => {
  test('shows banner when user token is missing required scopes', async ({
    adaContext,
  }) => {
    // No x-forwarded-access-token header, so all endpoint scopes are "missing"
    await adaContext.page.goto('/');
    const banner = adaContext.page.locator('text=on-behalf-of user authorization');
    await expect(banner).toBeVisible();
  });

  test('banner contains the missing scope names', async ({
    adaContext,
  }) => {
    await adaContext.page.goto('/');
    // The mock endpoint declares serving.serving-endpoints
    const banner = adaContext.page.locator('text=serving.serving-endpoints');
    await expect(banner).toBeVisible();
  });

  test('banner contains Learn more link to OBO docs', async ({
    adaContext,
  }) => {
    await adaContext.page.goto('/');
    const link = adaContext.page.locator('a[href*="enable-user-authorization"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('Learn more');
  });

  test('banner hidden when user token has all required scopes', async ({
    browser,
  }) => {
    // Create a context with a JWT that has the required scope
    const payload = { scope: 'serving.serving-endpoints offline_access', sub: 'test-user' };
    const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

    const context = await browser.newContext({
      extraHTTPHeaders: {
        'X-Forwarded-User': 'test-user-id',
        'X-Forwarded-Email': 'test@example.com',
        'X-Forwarded-Preferred-Username': 'test-user',
        'x-forwarded-access-token': fakeJwt,
      },
    });

    const page = await context.newPage();
    await page.goto('/');

    // Banner should NOT appear
    const banner = page.locator('text=on-behalf-of user authorization');
    await expect(banner).not.toBeVisible();

    await context.close();
  });
});
