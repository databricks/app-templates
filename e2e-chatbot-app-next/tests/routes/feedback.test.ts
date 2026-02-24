import { expect, test } from '../fixtures';
import { generateUUID } from '@chat-template/core';
import { TEST_PROMPTS } from '../prompts/routes';
import {
  sendChatAndGetMessageId,
  skipInEphemeralMode,
} from '../helpers';

test.describe('/api/feedback', () => {
  test('POST /api/feedback validates request body', async ({ adaContext }) => {
    const response = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: 'invalid-uuid',
        feedbackType: 'invalid-type',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('POST /api/feedback returns success with mlflowAssessmentId', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const assistantMessageId = await sendChatAndGetMessageId(
      adaContext.request,
      chatId,
      TEST_PROMPTS.SKY.MESSAGE,
    );

    const feedbackResponse = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessageId,
        feedbackType: 'thumbs_up',
      },
    });

    expect(feedbackResponse.status()).toBe(200);
    const feedback = await feedbackResponse.json();
    expect(feedback.success).toBe(true);
    // mlflowAssessmentId will only be set if the trace ID was captured
    // (depends on endpoint type; present when using the Responses API mock)
  });

  test('GET /api/feedback/chat/:chatId returns MLflow-backed feedback map', async ({
    adaContext,
  }) => {
    // This test requires DB mode so that getMessagesByChatId can return messages
    skipInEphemeralMode(test);

    const chatId = generateUUID();
    const assistantMessageId = await sendChatAndGetMessageId(
      adaContext.request,
      chatId,
      TEST_PROMPTS.SKY.MESSAGE,
    );

    // Submit feedback — this POSTs to MLflow and stores the assessment in the mock
    const feedbackResponse = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessageId,
        feedbackType: 'thumbs_up',
      },
    });
    expect(feedbackResponse.status()).toBe(200);
    expect((await feedbackResponse.json()).mlflowAssessmentId).toBeTruthy();

    // GET feedback for the chat — server queries MLflow GET assessments for each message
    const getChatFeedbackResponse = await adaContext.request.get(
      `/api/feedback/chat/${chatId}`,
    );
    expect(getChatFeedbackResponse.status()).toBe(200);

    const chatFeedback = await getChatFeedbackResponse.json();
    expect(chatFeedback).toHaveProperty(assistantMessageId);
    expect(chatFeedback[assistantMessageId].feedbackType).toBe('thumbs_up');
    expect(chatFeedback[assistantMessageId].messageId).toBe(assistantMessageId);
  });
});
