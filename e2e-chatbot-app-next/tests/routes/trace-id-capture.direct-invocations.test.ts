import { generateUUID } from '@chat-template/core';
import { expect, test } from '../fixtures';
import { parseSSEPayloads, sendChatAndGetMessageId } from '../helpers';

const TRACE_ID = 'mock-direct-invocations-trace-id';
const ASSESSMENT_ID = `mock-assessment-${TRACE_ID}`;

const USER_MESSAGE = {
  id: generateUUID(),
  role: 'user',
  parts: [{ type: 'text', text: 'Why is the sky blue?' }],
};

type CapturedRequest = {
  context?: { conversation_id?: string; user_id?: string };
  headers?: Record<string, string>;
};

function expectDirectIdentity(
  request: CapturedRequest,
  chatId: string,
  userEmail: string,
) {
  expect(request.headers?.['x-mlflow-return-trace-id']).toBe('true');
  expect(request.headers?.['x-appkit-session-id']).toBe(chatId);
  expect(request.headers?.['x-appkit-user-id']).toBe(userEmail);
  expect(request.headers?.['x-request-id']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(request.headers?.traceparent).toMatch(
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
  );
  expect(request.headers?.tracestate).toMatch(/^appkit=[0-9a-f]{16}$/);
  expect(request.context).toEqual({
    conversation_id: chatId,
    user_id: userEmail,
  });
}

test.describe('direct agent/v2/chat trace transport', () => {
  test.beforeEach(async ({ adaContext }) => {
    await adaContext.request.post('/api/test/reset-mlflow-store');
  });

  test('streaming request propagates identity, persists its trace, and accepts feedback', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const assistantMessageId = await sendChatAndGetMessageId(
      adaContext.request,
      chatId,
      USER_MESSAGE,
    );

    const requests = (await (
      await adaContext.request.get('/api/test/captured-requests')
    ).json()) as CapturedRequest[];
    const direct = requests.find(
      (request) => request.context?.conversation_id === chatId,
    );
    expect(direct).toBeDefined();
    if (!direct) throw new Error('Direct request was not captured');
    expectDirectIdentity(direct, chatId, `${adaContext.name}@example.com`);

    const feedback = await adaContext.request.post('/api/feedback', {
      data: { messageId: assistantMessageId, feedbackType: 'thumbs_up' },
    });
    expect(feedback.status()).toBe(200);
    expect((await feedback.json()).mlflowAssessmentId).toBe(ASSESSMENT_ID);
  });

  test('non-streaming fallback preserves identity and header trace for feedback', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: {
          id: generateUUID(),
          role: 'user',
          parts: [{ type: 'text', text: 'trigger stream error' }],
        },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });
    expect(response.status()).toBe(200);
    const payloads = parseSSEPayloads(await response.text()) as Array<{
      type?: string;
      messageId?: string;
      data?: unknown;
    }>;
    const assistantMessageId = payloads.find(
      (payload) => payload.type === 'start',
    )?.messageId;
    expect(assistantMessageId).toBeTruthy();
    expect(
      payloads.find((payload) => payload.type === 'data-traceId')?.data,
    ).toBe(TRACE_ID);

    const requests = (await (
      await adaContext.request.get('/api/test/captured-requests')
    ).json()) as CapturedRequest[];
    const direct = requests.filter(
      (request) => request.context?.conversation_id === chatId,
    );
    expect(direct).toHaveLength(2);
    for (const request of direct) {
      expectDirectIdentity(request, chatId, `${adaContext.name}@example.com`);
    }

    const feedback = await adaContext.request.post('/api/feedback', {
      data: { messageId: assistantMessageId, feedbackType: 'thumbs_down' },
    });
    expect(feedback.status()).toBe(200);
    expect((await feedback.json()).mlflowAssessmentId).toBe(ASSESSMENT_ID);
  });

  test('continuation reuses the assistant message and replaces its persisted trace', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const assistantMessageId = generateUUID();
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
        previousMessages: [
          USER_MESSAGE,
          {
            id: assistantMessageId,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Previous response' }],
          },
        ],
      },
    });
    expect(response.status()).toBe(200);
    const payloads = parseSSEPayloads(await response.text()) as Array<{
      type?: string;
      messageId?: string;
      data?: unknown;
    }>;
    expect(
      payloads.find((payload) => payload.type === 'start')?.messageId,
    ).toBe(assistantMessageId);
    expect(
      payloads.find((payload) => payload.type === 'data-traceId')?.data,
    ).toBe(TRACE_ID);

    const requests = (await (
      await adaContext.request.get('/api/test/captured-requests')
    ).json()) as CapturedRequest[];
    const direct = requests.find(
      (request) => request.context?.conversation_id === chatId,
    );
    expect(direct).toBeDefined();
    if (!direct) throw new Error('Direct continuation was not captured');
    expectDirectIdentity(direct, chatId, `${adaContext.name}@example.com`);

    const feedback = await adaContext.request.post('/api/feedback', {
      data: { messageId: assistantMessageId, feedbackType: 'thumbs_up' },
    });
    expect(feedback.status()).toBe(200);
    expect((await feedback.json()).mlflowAssessmentId).toBe(ASSESSMENT_ID);
  });
});
