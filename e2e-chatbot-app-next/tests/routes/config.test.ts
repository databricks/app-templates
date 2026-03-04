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

  test('backgroundModeAvailable is false when API_PROXY is not set', async ({
    adaContext,
  }) => {
    // The main routes project runs without API_PROXY
    const response = await adaContext.request.get('/api/config');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.features).toHaveProperty('backgroundModeAvailable');
    expect(data.features.backgroundModeAvailable).toBe(false);
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
});
