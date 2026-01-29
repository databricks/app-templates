import { generateUUID } from '@chat-template/core';
import { expect, test } from '../fixtures';
import { TEST_PROMPTS } from '../prompts/routes';

/**
 * Tests for context injection in requests to Databricks serving endpoints.
 *
 * Context (conversation_id and user_id) should be injected when:
 * 1. API_PROXY environment variable is set, OR
 * 2. Endpoint task type is 'agent/v2/chat' or 'agent/v1/responses'
 *
 * The default mock returns 'agent/v1/responses', so context should be injected
 * in all tests by default.
 */

interface CapturedRequest {
  url: string;
  timestamp: number;
  context?: {
    conversation_id?: string;
    user_id?: string;
    [key: string]: unknown;
  };
  hasContext: boolean;
}

test.describe.serial('Context Injection', () => {
  test.beforeEach(async ({ adaContext }) => {
    // Reset captured requests before each test
    await adaContext.request.post('/api/test/reset-captured-requests');
  });

  test.describe('agent/v1/responses endpoints', () => {
    test('injects context with conversation_id and user_id', async ({
      adaContext,
    }) => {
      const chatId = generateUUID();
      const response = await adaContext.request.post('/api/chat', {
        data: {
          id: chatId,
          message: TEST_PROMPTS.SKY.MESSAGE,
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        },
      });

      expect(response.status()).toBe(200);

      // Get captured requests from the server
      const capturedResponse = await adaContext.request.get(
        '/api/test/captured-requests',
      );
      const capturedRequests =
        (await capturedResponse.json()) as CapturedRequest[];

      // Find the request to the serving endpoint (responses endpoint)
      const chatRequest = capturedRequests.find(
        (req) =>
          req.url.includes('/chat/completions') ||
          req.url.includes('/responses'),
      );

      expect(chatRequest).toBeDefined();
      expect(chatRequest?.hasContext).toBe(true);
      expect(chatRequest?.context).toBeDefined();
      expect(chatRequest?.context?.conversation_id).toBe(chatId);
      // Ada's email from fixtures is 'ada-{workerIndex}@example.com'
      expect(chatRequest?.context?.user_id).toMatch(/ada.*@example\.com/);
    });

    test('conversation_id matches the chat id', async ({ adaContext }) => {
      const chatId = generateUUID();
      await adaContext.request.post('/api/chat', {
        data: {
          id: chatId,
          message: TEST_PROMPTS.SKY.MESSAGE,
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        },
      });

      const capturedResponse = await adaContext.request.get(
        '/api/test/captured-requests',
      );
      const capturedRequests =
        (await capturedResponse.json()) as CapturedRequest[];

      // Find the request for this chat
      const chatRequest = capturedRequests.find(
        (req) => req.context?.conversation_id === chatId,
      );

      expect(chatRequest).toBeDefined();
      expect(chatRequest?.context?.conversation_id).toBe(chatId);
    });
  });

  test.describe('user context', () => {
    test('user_id matches the authenticated user email', async ({
      adaContext,
    }) => {
      const chatId = generateUUID();
      await adaContext.request.post('/api/chat', {
        data: {
          id: chatId,
          message: TEST_PROMPTS.SKY.MESSAGE,
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        },
      });

      const capturedResponse = await adaContext.request.get(
        '/api/test/captured-requests',
      );
      const capturedRequests =
        (await capturedResponse.json()) as CapturedRequest[];

      // Find the request for this chat
      const chatRequest = capturedRequests.find(
        (req) => req.context?.conversation_id === chatId,
      );

      expect(chatRequest).toBeDefined();
      // Ada's email from fixtures is 'ada-{workerIndex}@example.com'
      expect(chatRequest?.context?.user_id).toMatch(/ada.*@example\.com/);
    });

    test('different users have different user_ids in context', async ({
      adaContext,
      babbageContext,
    }) => {
      // Ada's chat
      const adaChatId = generateUUID();
      await adaContext.request.post('/api/chat', {
        data: {
          id: adaChatId,
          message: TEST_PROMPTS.SKY.MESSAGE,
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        },
      });

      // Get Ada's captured request
      const adaCapturedResponse = await adaContext.request.get(
        '/api/test/captured-requests',
      );
      const adaCapturedRequests =
        (await adaCapturedResponse.json()) as CapturedRequest[];
      const adaRequest = adaCapturedRequests.find(
        (req) => req.context?.conversation_id === adaChatId,
      );

      // Reset for Babbage's request
      await babbageContext.request.post('/api/test/reset-captured-requests');

      // Babbage's chat
      const babbageChatId = generateUUID();
      await babbageContext.request.post('/api/chat', {
        data: {
          id: babbageChatId,
          message: TEST_PROMPTS.SKY.MESSAGE,
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        },
      });

      // Get Babbage's captured request
      const babbageCapturedResponse = await babbageContext.request.get(
        '/api/test/captured-requests',
      );
      const babbageCapturedRequests =
        (await babbageCapturedResponse.json()) as CapturedRequest[];
      const babbageRequest = babbageCapturedRequests.find(
        (req) => req.context?.conversation_id === babbageChatId,
      );

      expect(adaRequest).toBeDefined();
      expect(babbageRequest).toBeDefined();

      const adaUserId = adaRequest?.context?.user_id;
      const babbageUserId = babbageRequest?.context?.user_id;

      expect(adaUserId).toMatch(/ada/);
      expect(babbageUserId).toMatch(/babbage/);
      expect(adaUserId).not.toEqual(babbageUserId);
    });

    test('context is injected for each chat request', async ({ adaContext }) => {
      // First chat
      const firstChatId = generateUUID();
      await adaContext.request.post('/api/chat', {
        data: {
          id: firstChatId,
          message: TEST_PROMPTS.SKY.MESSAGE,
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        },
      });

      // Second chat
      const secondChatId = generateUUID();
      await adaContext.request.post('/api/chat', {
        data: {
          id: secondChatId,
          message: TEST_PROMPTS.SKY.MESSAGE,
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        },
      });

      const capturedResponse = await adaContext.request.get(
        '/api/test/captured-requests',
      );
      const capturedRequests =
        (await capturedResponse.json()) as CapturedRequest[];

      // Both requests should have context
      const firstRequest = capturedRequests.find(
        (req) => req.context?.conversation_id === firstChatId,
      );
      const secondRequest = capturedRequests.find(
        (req) => req.context?.conversation_id === secondChatId,
      );

      expect(firstRequest).toBeDefined();
      expect(firstRequest?.hasContext).toBe(true);

      expect(secondRequest).toBeDefined();
      expect(secondRequest?.hasContext).toBe(true);

      // Each request should have its own conversation_id
      expect(firstRequest?.context?.conversation_id).toBe(firstChatId);
      expect(secondRequest?.context?.conversation_id).toBe(secondChatId);
    });
  });
});
