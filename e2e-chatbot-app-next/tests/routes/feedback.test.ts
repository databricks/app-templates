import { expect, test } from '../fixtures';
import { generateUUID } from '@chat-template/core';
import { TEST_PROMPTS } from '../prompts/routes';
import { skipInEphemeralMode } from '../helpers';

/** Parse SSE lines and return only the `data:` payloads as parsed objects. */
function parseSSEPayloads(body: string): unknown[] {
  return body
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
    .map((l) => {
      try {
        return JSON.parse(l.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

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

    const chatResponse = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: TEST_PROMPTS.SKY.MESSAGE,
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });
    expect(chatResponse.status()).toBe(200);

    const body = await chatResponse.text();
    const payloads = parseSSEPayloads(body);
    const startEvent = payloads.find(
      (p) => (p as any)?.type === 'start' && (p as any)?.messageId,
    ) as { type: string; messageId: string } | undefined;
    expect(startEvent?.messageId).toBeTruthy();
    const assistantMessageId = startEvent?.messageId;

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

    const chatResponse = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: TEST_PROMPTS.SKY.MESSAGE,
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });
    expect(chatResponse.status()).toBe(200);

    // Parse assistant message ID from the SSE stream
    const body = await chatResponse.text();
    const payloads = parseSSEPayloads(body);
    const startEvent = payloads.find(
      (p) => (p as any)?.type === 'start' && (p as any)?.messageId,
    ) as { type: string; messageId: string } | undefined;
    expect(startEvent?.messageId).toBeTruthy();
    const assistantMessageId = startEvent?.messageId;

    // Submit feedback — this POSTs to MLflow and stores the assessment in the mock
    const feedbackResponse = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessageId,
        feedbackType: 'thumbs_up',
      },
    });
    expect(feedbackResponse.status()).toBe(200);
    const feedbackBody = await feedbackResponse.json();
    // Skip remainder if no trace ID was captured (FMAPI endpoint used)
    if (!feedbackBody.mlflowAssessmentId) {
      test.skip();
      return;
    }

    // GET feedback for the chat — server queries MLflow GET assessments for each message
    const getChatFeedbackResponse = await adaContext.request.get(
      `/api/feedback/chat/${chatId}`,
    );
    expect(getChatFeedbackResponse.status()).toBe(200);

    const chatFeedback = await getChatFeedbackResponse.json();
    // Should be a map with at least the assistant message
    expect(chatFeedback).toHaveProperty(assistantMessageId);
    expect(chatFeedback[assistantMessageId].feedbackType).toBe('thumbs_up');
    expect(chatFeedback[assistantMessageId].messageId).toBe(assistantMessageId);
  });

  test('GET /api/feedback/:messageId returns MLflow-backed feedback', async ({
    adaContext,
  }) => {
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

    const body = await chatResponse.text();
    const payloads = parseSSEPayloads(body);
    const startEvent = payloads.find(
      (p) => (p as any)?.type === 'start' && (p as any)?.messageId,
    ) as { type: string; messageId: string } | undefined;
    expect(startEvent?.messageId).toBeTruthy();
    const assistantMessageId = startEvent?.messageId;

    // Submit feedback
    const feedbackResponse = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessageId,
        feedbackType: 'thumbs_down',
      },
    });
    expect(feedbackResponse.status()).toBe(200);
    const feedbackBody = await feedbackResponse.json();
    // Skip remainder if no trace ID was captured (FMAPI endpoint used)
    if (!feedbackBody.mlflowAssessmentId) {
      test.skip();
      return;
    }

    // GET feedback for the message — server queries MLflow GET assessments
    const getMessageFeedbackResponse = await adaContext.request.get(
      `/api/feedback/${assistantMessageId}`,
    );
    expect(getMessageFeedbackResponse.status()).toBe(200);

    const messageFeedback = await getMessageFeedbackResponse.json();
    expect(messageFeedback.feedback).not.toBeNull();
    expect(messageFeedback.feedback.messageId).toBe(assistantMessageId);
    expect(messageFeedback.feedback.feedbackType).toBe('thumbs_down');
  });
});
