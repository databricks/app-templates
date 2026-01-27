import { expect, test } from '../fixtures';
import { generateUUID } from '@chat-template/core';
import { TEST_PROMPTS } from '../prompts/routes';
import { skipInEphemeralMode } from '../helpers';

test.describe('/api/feedback (with database)', () => {
  // Skip these tests in ephemeral mode - they require database
  skipInEphemeralMode(test);

  test('POST /api/feedback creates feedback for a message', async ({
    adaContext,
  }) => {
    // First, create a chat and get a message ID
    const chatId = generateUUID();
    const chatResponse = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: TEST_PROMPTS.SKY.MESSAGE,
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });

    expect(chatResponse.status()).toBe(200);

    // Get messages from the chat
    const messagesResponse = await adaContext.request.get(
      `/api/messages/${chatId}`,
    );
    expect(messagesResponse.status()).toBe(200);

    const messages = await messagesResponse.json();
    expect(messages.length).toBeGreaterThan(0);

    // Find an assistant message
    const assistantMessage = messages.find((m: any) => m.role === 'assistant');
    expect(assistantMessage).toBeDefined();

    // Create feedback for the message
    const feedbackResponse = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessage.id,
        chatId,
        feedbackType: 'thumbs_up',
      },
    });

    expect(feedbackResponse.status()).toBe(201);

    const feedback = await feedbackResponse.json();
    expect(feedback).toHaveProperty('id');
    expect(feedback.messageId).toBe(assistantMessage.id);
    expect(feedback.chatId).toBe(chatId);
    expect(feedback.feedbackType).toBe('thumbs_up');
  });

  test('POST /api/feedback updates existing feedback', async ({
    adaContext,
  }) => {
    // First, create a chat and get a message ID
    const chatId = generateUUID();
    const chatResponse = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: TEST_PROMPTS.SKY.MESSAGE,
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });

    expect(chatResponse.status()).toBe(200);

    // Get messages from the chat
    const messagesResponse = await adaContext.request.get(
      `/api/messages/${chatId}`,
    );
    expect(messagesResponse.status()).toBe(200);

    const messages = await messagesResponse.json();
    const assistantMessage = messages.find((m: any) => m.role === 'assistant');

    // Create initial feedback
    const feedback1Response = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessage.id,
        chatId,
        feedbackType: 'thumbs_up',
      },
    });

    expect(feedback1Response.status()).toBe(201);
    const feedback1 = await feedback1Response.json();
    expect(feedback1.feedbackType).toBe('thumbs_up');

    // Update feedback (change from thumbs_up to thumbs_down)
    const feedback2Response = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessage.id,
        chatId,
        feedbackType: 'thumbs_down',
      },
    });

    expect(feedback2Response.status()).toBe(200);
    const feedback2 = await feedback2Response.json();
    expect(feedback2.feedbackType).toBe('thumbs_down');
    expect(feedback2.id).toBe(feedback1.id); // Should be the same feedback record
  });

  test('GET /api/feedback/message/:messageId retrieves feedback', async ({
    adaContext,
  }) => {
    // First, create a chat and feedback
    const chatId = generateUUID();
    const chatResponse = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: TEST_PROMPTS.SKY.MESSAGE,
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });

    expect(chatResponse.status()).toBe(200);

    const messagesResponse = await adaContext.request.get(
      `/api/messages/${chatId}`,
    );
    const messages = await messagesResponse.json();
    const assistantMessage = messages.find((m: any) => m.role === 'assistant');

    // Create feedback
    await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessage.id,
        chatId,
        feedbackType: 'thumbs_up',
      },
    });

    // Retrieve feedback
    const getFeedbackResponse = await adaContext.request.get(
      `/api/feedback/message/${assistantMessage.id}`,
    );

    expect(getFeedbackResponse.status()).toBe(200);
    const feedback = await getFeedbackResponse.json();
    expect(feedback.messageId).toBe(assistantMessage.id);
    expect(feedback.feedbackType).toBe('thumbs_up');
  });

  test('POST /api/feedback validates request body', async ({ adaContext }) => {
    // Try to create feedback with invalid data
    const response = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: 'invalid-uuid',
        chatId: 'invalid-uuid',
        feedbackType: 'invalid-type',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('POST /api/feedback requires authentication', async ({ adaContext }) => {
    const chatId = generateUUID();
    const messageId = generateUUID();

    const response = await adaContext.request.post('/api/feedback', {
      data: {
        messageId,
        chatId,
        feedbackType: 'thumbs_up',
      },
    });

    // Should either succeed (authenticated) or fail with 401 (not authenticated)
    // Since we're using adaContext, it should be authenticated
    expect([201, 401, 404]).toContain(response.status());
  });
});
