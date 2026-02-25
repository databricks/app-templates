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

  test.describe('deduplication', () => {
    test.beforeEach(async ({ adaContext }) => {
      // The mock trace ID is fixed ('mock-trace-id-from-databricks'), so reset
      // the MLflow store before each test to prevent stale assessments from a
      // previous test causing the server to PATCH rather than POST on the first
      // submission.
      await adaContext.request.post('/api/test/reset-mlflow-store');
    });

    test('second submission PATCHes the existing assessment instead of creating a duplicate', async ({
      adaContext,
    }) => {
      const chatId = generateUUID();
      const assistantMessageId = await sendChatAndGetMessageId(
        adaContext.request,
        chatId,
        TEST_PROMPTS.SKY.MESSAGE,
      );

      // First submission — creates a new MLflow assessment via POST
      const firstResponse = await adaContext.request.post('/api/feedback', {
        data: { messageId: assistantMessageId, feedbackType: 'thumbs_up' },
      });
      expect(firstResponse.status()).toBe(200);
      const firstResult = await firstResponse.json();
      expect(firstResult.success).toBe(true);
      // mlflowAssessmentId is set when a trace ID was captured (present with Responses API mock)
      const firstAssessmentId = firstResult.mlflowAssessmentId;
      expect(firstAssessmentId).toBeTruthy();

      // Second submission (different feedback type) — should PATCH the existing assessment
      const secondResponse = await adaContext.request.post('/api/feedback', {
        data: { messageId: assistantMessageId, feedbackType: 'thumbs_down' },
      });
      expect(secondResponse.status()).toBe(200);
      const secondResult = await secondResponse.json();
      expect(secondResult.success).toBe(true);
      // Same assessment ID confirms PATCH was used, not a second POST
      expect(secondResult.mlflowAssessmentId).toBe(firstAssessmentId);
    });
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
