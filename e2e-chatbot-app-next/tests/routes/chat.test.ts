import { generateUUID } from '@/lib/utils';
import { expect, test } from '../fixtures';
import { TEST_PROMPTS } from '../prompts/routes';
import { getMessageByErrorCode } from '@/lib/errors';

const chatIdsCreatedByAda: Array<string> = [];

// Helper function to normalize stream data for comparison
function normalizeStreamData(lines: string[]): string[] {
  return lines.filter(Boolean).map((line) => {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix
        // Replace dynamic ids with a static one for comparison
        if (data.id) data.id = 'STATIC_ID';
        if (data.messageId) data.messageId = 'STATIC_MESSAGE_ID';
        return `data: ${JSON.stringify(data)}`;
      } catch {
        return line; // Return as-is if it's not valid JSON
      }
    }
    return line;
  });
}

test.describe
  .serial('/api/chat', () => {
    test('Ada cannot invoke a chat generation with empty request body', async ({
      adaContext,
    }) => {
      const response = await adaContext.request.post('/api/chat', {
        data: JSON.stringify({}),
      });
      expect(response.status()).toBe(400);

      const { code, message } = await response.json();
      expect(code).toEqual('bad_request:api');
      expect(message).toEqual(getMessageByErrorCode('bad_request:api'));
    });

    test('Ada can invoke chat generation', async ({ adaContext }) => {
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

      const text = await response.text();
      const lines = normalizeStreamData(text.split('\n'));
      lines.forEach((line, index) => {
        expect(line).toContain(
          TEST_PROMPTS.SKY.OUTPUT_STREAM.expectedSSE[index],
        );
      });

      chatIdsCreatedByAda.push(chatId);
    });

    test("Babbage cannot append message to Ada's chat", async ({
      babbageContext,
    }) => {
      const [chatId] = chatIdsCreatedByAda;

      const response = await babbageContext.request.post('/api/chat', {
        data: {
          id: chatId,
          message: TEST_PROMPTS.GRASS.MESSAGE,
          selectedChatModel: 'chat-model',
          selectedVisibilityType: 'private',
        },
      });
      expect(response.status()).toBe(403);

      const { code, message } = await response.json();
      expect(code).toEqual('forbidden:chat');
      expect(message).toEqual(getMessageByErrorCode('forbidden:chat'));
    });

    test("Babbage cannot delete Ada's chat", async ({ babbageContext }) => {
      const [chatId] = chatIdsCreatedByAda;

      const response = await babbageContext.request.delete(
        `/api/chat?id=${chatId}`,
      );
      expect(response.status()).toBe(403);

      const { code, message } = await response.json();
      expect(code).toEqual('forbidden:chat');
      expect(message).toEqual(getMessageByErrorCode('forbidden:chat'));
    });

    test('Ada can delete her own chat', async ({ adaContext }) => {
      const [chatId] = chatIdsCreatedByAda;

      const response = await adaContext.request.delete(
        `/api/chat?id=${chatId}`,
      );
      expect(response.status()).toBe(200);

      const deletedChat = await response.json();
      expect(deletedChat).toMatchObject({ id: chatId });
    });

    test('Ada cannot resume stream of chat that does not exist', async ({
      adaContext,
    }) => {
      const response = await adaContext.request.get(
        `/api/chat/${generateUUID()}/stream`,
      );
      expect(response.status()).toBe(204);
    });

    // test('Ada can resume chat generation', async ({ adaContext }) => {
    //   const chatId = generateUUID();

    //   const firstRequest = adaContext.request.post('/api/chat', {
    //     data: {
    //       id: chatId,
    //       message: {
    //         id: generateUUID(),
    //         role: 'user',
    //         content: 'Help me write an essay about Silcon Valley',
    //         parts: [
    //           {
    //             type: 'text',
    //             text: 'Help me write an essay about Silicon Valley',
    //           },
    //         ],
    //         createdAt: new Date().toISOString(),
    //       },
    //       selectedChatModel: 'chat-model',
    //       selectedVisibilityType: 'private',
    //     },
    //   });

    //   await new Promise((resolve) => setTimeout(resolve, 1000));

    //   const secondRequest = adaContext.request.get(
    //     `/api/chat/${chatId}/stream`,
    //   );

    //   const [firstResponse, secondResponse] = await Promise.all([
    //     firstRequest,
    //     secondRequest,
    //   ]);

    //   const [firstStatusCode, secondStatusCode] = await Promise.all([
    //     firstResponse.status(),
    //     secondResponse.status(),
    //   ]);

    //   expect(firstStatusCode).toBe(200);
    //   expect(secondStatusCode).toBe(200);

    //   const [firstResponseBody, secondResponseBody] = await Promise.all([
    //     await firstResponse.body(),
    //     await secondResponse.body(),
    //   ]);

    //   expect(firstResponseBody.toString()).toEqual(
    //     secondResponseBody.toString(),
    //   );
    // });

    // test('Ada can resume chat generation that has ended during request', async ({
    //   adaContext,
    // }) => {
    //   const chatId = generateUUID();

    //   const firstRequest = await adaContext.request.post('/api/chat', {
    //     data: {
    //       id: chatId,
    //       message: {
    //         id: generateUUID(),
    //         role: 'user',
    //         content: 'Help me write an essay about Silcon Valley',
    //         parts: [
    //           {
    //             type: 'text',
    //             text: 'Help me write an essay about Silicon Valley',
    //           },
    //         ],
    //         createdAt: new Date().toISOString(),
    //       },
    //       selectedChatModel: 'chat-model',
    //       selectedVisibilityType: 'private',
    //     },
    //   });

    //   const secondRequest = adaContext.request.get(
    //     `/api/chat/${chatId}/stream`,
    //   );

    //   const [firstResponse, secondResponse] = await Promise.all([
    //     firstRequest,
    //     secondRequest,
    //   ]);

    //   const [firstStatusCode, secondStatusCode] = await Promise.all([
    //     firstResponse.status(),
    //     secondResponse.status(),
    //   ]);

    //   expect(firstStatusCode).toBe(200);
    //   expect(secondStatusCode).toBe(200);

    //   const [, secondResponseContent] = await Promise.all([
    //     firstResponse.text(),
    //     secondResponse.text(),
    //   ]);

    //   expect(secondResponseContent).toContain('appendMessage');
    // });

    // test('Ada cannot resume chat generation that has ended', async ({
    //   adaContext,
    // }) => {
    //   const chatId = generateUUID();

    //   const firstResponse = await adaContext.request.post('/api/chat', {
    //     data: {
    //       id: chatId,
    //       message: {
    //         id: generateUUID(),
    //         role: 'user',
    //         content: 'Help me write an essay about Silcon Valley',
    //         parts: [
    //           {
    //             type: 'text',
    //             text: 'Help me write an essay about Silicon Valley',
    //           },
    //         ],
    //         createdAt: new Date().toISOString(),
    //       },
    //       selectedChatModel: 'chat-model',
    //       selectedVisibilityType: 'private',
    //     },
    //   });

    //   const firstStatusCode = firstResponse.status();
    //   expect(firstStatusCode).toBe(200);

    //   await firstResponse.text();
    //   await new Promise((resolve) => setTimeout(resolve, 15 * 1000));
    //   await new Promise((resolve) => setTimeout(resolve, 15000));
    //   const secondResponse = await adaContext.request.get(
    //     `/api/chat/${chatId}/stream`,
    //   );

    //   const secondStatusCode = secondResponse.status();
    //   expect(secondStatusCode).toBe(200);

    //   const secondResponseContent = await secondResponse.text();
    //   expect(secondResponseContent).toEqual('');
    // });

    // test('Babbage cannot resume a private chat generation that belongs to Ada', async ({
    //   adaContext,
    //   babbageContext,
    // }) => {
    //   const chatId = generateUUID();

    //   const firstRequest = adaContext.request.post('/api/chat', {
    //     data: {
    //       id: chatId,
    //       message: {
    //         id: generateUUID(),
    //         role: 'user',
    //         content: 'Help me write an essay about Silcon Valley',
    //         parts: [
    //           {
    //             type: 'text',
    //             text: 'Help me write an essay about Silicon Valley',
    //           },
    //         ],
    //         createdAt: new Date().toISOString(),
    //       },
    //       selectedChatModel: 'chat-model',
    //       selectedVisibilityType: 'private',
    //     },
    //   });

    //   await new Promise((resolve) => setTimeout(resolve, 1000));

    //   const secondRequest = babbageContext.request.get(
    //     `/api/chat/${chatId}/stream`,
    //   );

    //   const [firstResponse, secondResponse] = await Promise.all([
    //     firstRequest,
    //     secondRequest,
    //   ]);

    //   const [firstStatusCode, secondStatusCode] = await Promise.all([
    //     firstResponse.status(),
    //     secondResponse.status(),
    //   ]);

    //   expect(firstStatusCode).toBe(200);
    //   expect(secondStatusCode).toBe(403);
    // });

    // test('Babbage can resume a public chat generation that belongs to Ada', async ({
    //   adaContext,
    //   babbageContext,
    // }) => {
    //   test.fixme();
    //   const chatId = generateUUID();

    //   const firstRequest = adaContext.request.post('/api/chat', {
    //     data: {
    //       id: chatId,
    //       message: {
    //         id: generateUUID(),
    //         role: 'user',
    //         content: 'Help me write an essay about Silicon Valley',
    //         parts: [
    //           {
    //             type: 'text',
    //             text: 'Help me write an essay about Silicon Valley',
    //           },
    //         ],
    //         createdAt: new Date().toISOString(),
    //       },
    //       selectedChatModel: 'chat-model',
    //       selectedVisibilityType: 'public',
    //     },
    //   });

    //   await new Promise((resolve) => setTimeout(resolve, 10 * 1000));

    //   const secondRequest = babbageContext.request.get(
    //     `/api/chat/${chatId}/stream`,
    //   );

    //   const [firstResponse, secondResponse] = await Promise.all([
    //     firstRequest,
    //     secondRequest,
    //   ]);

    //   const [firstStatusCode, secondStatusCode] = await Promise.all([
    //     firstResponse.status(),
    //     secondResponse.status(),
    //   ]);

    //   expect(firstStatusCode).toBe(200);
    //   expect(secondStatusCode).toBe(200);

    //   const [firstResponseContent, secondResponseContent] = await Promise.all([
    //     firstResponse.text(),
    //     secondResponse.text(),
    //   ]);

    //   expect(firstResponseContent).toEqual(secondResponseContent);
    // });
  });
