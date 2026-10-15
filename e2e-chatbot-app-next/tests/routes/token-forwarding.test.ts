import { expect, test } from '../fixtures';
import { randomUUID } from 'crypto';

function chatRequestBody() {
  return {
    id: randomUUID(),
    message: {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    },
    selectedChatModel: 'chat-model',
    selectedVisibilityType: 'private',
  };
}

test.describe('OBO Token Forwarding', () => {
  test.describe.configure({ mode: 'serial' });

  test('uses SP token when no user token is present', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post('/api/chat', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: chatRequestBody(),
    });

    await response.text();

    const headersResponse = await adaContext.request.get('/api/test/serving-request-headers');
    const headers = await headersResponse.json();

    // Authorization should be set (SP token)
    expect(headers['authorization']).toBeDefined();
    expect(headers['authorization']).toMatch(/^Bearer .+/);
    // Should NOT contain a user OBO token
    expect(headers['x-forwarded-access-token']).toBeUndefined();
  });

  test('forwards user token as Authorization and keeps x-forwarded-access-token', async ({
    adaContext,
  }) => {
    const fakeUserToken = 'test-user-obo-token-12345';

    const response = await adaContext.request.post('/api/chat', {
      headers: {
        'x-forwarded-access-token': fakeUserToken,
        'Content-Type': 'application/json',
      },
      data: chatRequestBody(),
    });

    await response.text();

    const headersResponse = await adaContext.request.get('/api/test/serving-request-headers');
    const headers = await headersResponse.json();

    // User token should be used for Authorization
    expect(headers['authorization']).toBe(`Bearer ${fakeUserToken}`);
    // x-forwarded-access-token should still be present (not stripped)
    expect(headers['x-forwarded-access-token']).toBe(fakeUserToken);
  });
});
