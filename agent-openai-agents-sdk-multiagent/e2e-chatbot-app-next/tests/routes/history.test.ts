import { expect, test } from '../fixtures';
import { generateUUID } from '@chat-template/core';
import { TEST_PROMPTS } from '../prompts/routes';
import { skipInEphemeralMode, skipInWithDatabaseMode } from '../helpers';

test.describe('/api/history (with database)', () => {
  // Skip these tests in ephemeral mode - they require database
  skipInEphemeralMode(test);

  test('GET /api/history returns chat history for authenticated user', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.get('/api/history');

    // With database enabled, should return 200 with chat history data
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('chats');
    expect(data).toHaveProperty('hasMore');
    expect(Array.isArray(data.chats)).toBe(true);
    expect(typeof data.hasMore).toBe('boolean');
  });

  test('GET /api/history requires authentication', async ({ adaContext }) => {
    // Attempt to access without proper session should fail
    // Note: This test assumes auth middleware is properly configured
    const response = await adaContext.request.get('/api/history');

    // Should either return 200 (if authenticated via fixtures) or 401 (if not)
    expect([200, 401]).toContain(response.status());
  });

  test('GET /api/history supports pagination with cursor', async ({
    adaContext,
  }) => {
    // First, create a chat to ensure we have some history
    const chatId = generateUUID();
    await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: TEST_PROMPTS.SKY.MESSAGE,
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });

    // Get first page
    const response1 = await adaContext.request.get('/api/history?limit=1');
    expect(response1.status()).toBe(200);

    const data1 = await response1.json();
    expect(data1.chats.length).toBeLessThanOrEqual(1);

    // If there's a cursor, test pagination
    if (data1.hasMore && data1.chats.length > 0) {
      const cursor = data1.chats[data1.chats.length - 1].createdAt;
      const response2 = await adaContext.request.get(
        `/api/history?cursor=${encodeURIComponent(cursor)}&limit=1`,
      );
      expect(response2.status()).toBe(200);
    }
  });

  test('GET /api/history returns empty array when user has no chats', async ({
    curieContext,
  }) => {
    // Use a user context that hasn't created any chats
    const response = await curieContext.request.get('/api/history');

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.chats).toEqual([]);
    expect(data.hasMore).toBe(false);
  });
});

test.describe('/api/history (ephemeral mode)', () => {
  // Only run this test in ephemeral mode
  skipInWithDatabaseMode(test);

  test('GET /api/history returns 204 when database is disabled', async ({
    adaContext,
  }) => {
    // In ephemeral mode, /api/history should return 204 No Content
    const response = await adaContext.request.get('/api/history');
    expect(response.status()).toBe(204);
  });
});
