import { expect, test } from '../fixtures';

test.describe('/api/config', () => {
  test('GET /api/config returns correct feature flags', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.get('/api/config');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('features');
    expect(data.features).toHaveProperty('chatHistory');
    expect(typeof data.features.chatHistory).toBe('boolean');
    expect(data.features).toHaveProperty('feedback');
    expect(typeof data.features.feedback).toBe('boolean');

    if (process.env.TEST_MODE === 'with-db') {
      // In the test environment with database configured, chatHistory should be true
      expect(data.features.chatHistory).toBe(true);
    } else {
      // In the test environment without database configured, chatHistory should be false
      expect(data.features.chatHistory).toBe(false);
    }
  });

  test('GET /api/config does not require authentication', async ({
    adaContext,
  }) => {
    // Create a new request context without authentication headers
    const response = await adaContext.request.get('/api/config');

    // Config endpoint should be accessible without auth
    expect(response.status()).toBe(200);
  });

  test('GET /api/config returns consistent values across multiple requests', async ({
    adaContext,
  }) => {
    // Make multiple requests to ensure config is consistent
    const response1 = await adaContext.request.get('/api/config');
    const response2 = await adaContext.request.get('/api/config');

    const data1 = await response1.json();
    const data2 = await response2.json();

    expect(data1).toEqual(data2);
  });

  test('GET /api/config omits greeting when CHAT_GREETING is unset', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.get('/api/config');
    const data = await response.json();

    expect(data.greeting).toBeUndefined();
  });

  test('GET /api/config returns OBO info', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.get('/api/config');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('obo');
    expect(data.obo).toHaveProperty('missingScopes');
  });

  test('GET /api/config shows missing scopes when user token lacks required scopes', async ({
    adaContext,
  }) => {
    // Build a JWT with only "offline_access" scope (missing model-serving)
    const payload = { scope: 'offline_access', sub: 'test-user' };
    const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

    const response = await adaContext.request.get('/api/config', {
      headers: { 'x-forwarded-access-token': fakeJwt },
    });
    const data = await response.json();

    // model-serving should be missing
    expect(data.obo.missingScopes).toContain('model-serving');
  });

  test('GET /api/config shows no missing scopes when user token has all required scopes', async ({
    adaContext,
  }) => {
    // Build a JWT that has model-serving
    const payload = { scope: 'model-serving offline_access', sub: 'test-user' };
    const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

    const response = await adaContext.request.get('/api/config', {
      headers: { 'x-forwarded-access-token': fakeJwt },
    });
    const data = await response.json();

    expect(data.obo.missingScopes).toEqual([]);
  });

  test('GET /api/config exact scope satisfies requirement', async ({
    adaContext,
  }) => {
    // Build a JWT with model-serving scope
    const payload = { scope: 'model-serving offline_access', sub: 'test-user' };
    const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

    const response = await adaContext.request.get('/api/config', {
      headers: { 'x-forwarded-access-token': fakeJwt },
    });
    const data = await response.json();

    // model-serving should satisfy the requirement
    expect(data.obo.missingScopes).toEqual([]);
  });
});
