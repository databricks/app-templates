import { expect, test } from '../fixtures';

test.describe('Session', () => {
  test('GET /api/session returns user from forwarded headers', async ({
    adaContext,
  }) => {
    const res = await adaContext.request.get('/api/session');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.user.email).toBe(`${adaContext.name}@example.com`);
  });
});
