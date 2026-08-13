/**
 * Integration tests verifying the end-to-end trace ID capture pipeline.
 *
 * Flow under test:
 *  1. chat.ts passes `providerOptions.databricks.includeTrace: true`
 *     to streamText(). The AI SDK provider converts this to
 *     `databricks_options.return_trace: true` in the Responses API request body.
 *  2. The mock Databricks server detects return_trace and includes
 *     `databricks_output.trace.info.trace_id` in the response.output_item.done event.
 *  3. chat.ts captures the trace ID directly from the raw SSE event in onChunk.
 *  4. On feedback submission the trace ID is forwarded to the mock MLflow endpoint.
 *  5. The feedback response includes `mlflowAssessmentId` proving the full chain worked.
 *
 * These tests run in both ephemeral and with-db modes:
 * - Ephemeral: trace ID lives in the in-memory message-meta-store.
 * - With-db:   trace ID is persisted to the database alongside the message.
 */

import { generateUUID } from '@chat-template/core';
import { expect, test } from '../fixtures';
import {
  parseSSEPayloads,
  sendChatAndGetMessageId,
  skipInEphemeralMode,
} from '../helpers';
import { ChatPage } from '../pages/chat';

const MOCK_TRACE_ID = 'mock-trace-id-from-databricks';
const MOCK_ASSESSMENT_ID = `mock-assessment-${MOCK_TRACE_ID}`;

const TEST_MESSAGE = {
  id: generateUUID(),
  role: 'user',
  parts: [{ type: 'text', text: 'Why is the sky blue?' }],
};

test.describe('/api/chat — trace ID capture via providerOptions', () => {
  test.beforeEach(async ({ adaContext }) => {
    await adaContext.request.post('/api/test/reset-mlflow-store');
  });

  test('every upstream request carries trace discovery and W3C/AppKit identity', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    await sendChatAndGetMessageId(adaContext.request, chatId, TEST_MESSAGE);

    const requests = (await (
      await adaContext.request.get('/api/test/captured-requests')
    ).json()) as Array<{
      context?: { conversation_id?: string };
      headers?: Record<string, string>;
    }>;
    const headers = requests.find(
      (request) => request.context?.conversation_id === chatId,
    )?.headers;
    expect(headers).toBeDefined();
    expect(headers?.['x-mlflow-return-trace-id']).toBe('true');
    expect(headers?.['x-appkit-session-id']).toBe(chatId);
    expect(headers?.['x-appkit-user-id']).toBe(
      `${adaContext.name}@example.com`,
    );
    expect(headers?.['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(headers?.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
    );
    expect(headers?.tracestate).toMatch(/^appkit=[0-9a-f]{16}$/);
  });

  test('trace ID is captured and used in MLflow feedback submission', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    // Step 1: Send a chat message. providerOptions.databricks.includeTrace: true
    // forwards return_trace: true in the Responses API request body, which
    // causes the MSW mock to include a trace ID in the response stream.
    const assistantMessageId = await sendChatAndGetMessageId(
      adaContext.request,
      chatId,
      TEST_MESSAGE,
    );

    // Step 2: Submit feedback. The server should look up the trace ID that was
    // captured during streaming and forward it to the MLflow assessments endpoint.
    const feedbackResponse = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessageId,
        feedbackType: 'thumbs_up',
      },
    });

    expect(feedbackResponse.status()).toBe(200);
    const feedbackBody = await feedbackResponse.json();
    expect(feedbackBody.success).toBe(true);

    // mlflowAssessmentId is only non-null when:
    //  - databricks_options.return_trace was present in the Databricks request
    //    (injected by databricksFetch — the thing we are testing)
    //  - The trace ID from the response was captured by onChunk in chat.ts
    //  - MLflow submission succeeded using that trace ID
    expect(feedbackBody.mlflowAssessmentId).toBe(MOCK_ASSESSMENT_ID);
  });

  test('continuation reuses the assistant message and attaches its returned trace', async ({
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
          TEST_MESSAGE,
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
    ).toBe(MOCK_TRACE_ID);

    const feedback = await adaContext.request.post('/api/feedback', {
      data: { messageId: assistantMessageId, feedbackType: 'thumbs_up' },
    });
    expect(feedback.status()).toBe(200);
    expect((await feedback.json()).mlflowAssessmentId).toBe(MOCK_ASSESSMENT_ID);
  });

  test('approval resume sends trace discovery and identity on its continuation request', async ({
    adaContext,
  }) => {
    const chatPage = new ChatPage(adaContext.page);
    await chatPage.createNewChat();
    await chatPage.sendUserMessage('Trigger MCP tool');
    const allow = adaContext.page.getByTestId('mcp-approval-allow');
    await expect(allow).toBeVisible({ timeout: 10_000 });

    const continuation = adaContext.page.waitForResponse(
      (response) =>
        response.url().includes('/api/chat') &&
        response.request().method() === 'POST',
    );
    await allow.click();
    const continuationResponse = await continuation;
    expect(continuationResponse.status()).toBe(200);
    await expect(
      adaContext.page.getByText('The tool has been executed successfully.'),
    ).toBeVisible({ timeout: 10_000 });

    const chatId = continuationResponse.request().postDataJSON().id;
    const requests = (await (
      await adaContext.request.get('/api/test/captured-requests')
    ).json()) as Array<{
      context?: { conversation_id?: string };
      headers?: Record<string, string>;
    }>;
    const headers = requests
      .filter((request) => request.context?.conversation_id === chatId)
      .at(-1)?.headers;
    expect(headers).toBeDefined();
    expect(headers?.['x-mlflow-return-trace-id']).toBe('true');
    expect(headers?.['x-appkit-session-id']).toBe(chatId);
    expect(headers?.['x-appkit-user-id']).toBe(
      `${adaContext.name}@example.com`,
    );
    expect(headers?.['x-request-id']).toBeTruthy();
    expect(headers?.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
    );
  });

  test('database approval denial preserves the existing assistant trace for feedback', async ({
    adaContext,
  }) => {
    skipInEphemeralMode(test);
    const chatId = generateUUID();
    const assistantMessageId = await sendChatAndGetMessageId(
      adaContext.request,
      chatId,
      TEST_MESSAGE,
    );

    const denial = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
        previousMessages: [
          TEST_MESSAGE,
          {
            id: assistantMessageId,
            role: 'assistant',
            parts: [
              {
                type: 'dynamic-tool',
                toolCallId: 'approval-call',
                toolName: 'approval-tool',
                state: 'output-denied',
                approval: { approved: false },
              },
            ],
          },
        ],
      },
    });
    expect(denial.status()).toBe(200);
    expect(await denial.text()).toBe('');

    const feedback = await adaContext.request.post('/api/feedback', {
      data: { messageId: assistantMessageId, feedbackType: 'thumbs_down' },
    });
    expect(feedback.status()).toBe(200);
    expect((await feedback.json()).mlflowAssessmentId).toBe(MOCK_ASSESSMENT_ID);
  });

  test('non-streaming fallback still asks for a trace and exposes a missing trace without losing text', async ({
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
      data?: unknown;
    }>;
    expect(payloads.some((payload) => payload.type === 'text-delta')).toBe(
      true,
    );
    expect(
      payloads.find((payload) => payload.type === 'data-traceId')?.data,
    ).toBeNull();
    expect(
      payloads.find((payload) => payload.type === 'data-error')?.data,
    ).toMatch(/trace id/i);

    const requests = (await (
      await adaContext.request.get('/api/test/captured-requests')
    ).json()) as Array<{
      context?: { conversation_id?: string };
      headers?: Record<string, string>;
    }>;
    const chatRequests = requests.filter(
      (request) => request.context?.conversation_id === chatId,
    );
    expect(chatRequests).toHaveLength(2);
    for (const request of chatRequests) {
      expect(request.headers?.['x-mlflow-return-trace-id']).toBe('true');
      expect(request.headers?.['x-appkit-session-id']).toBe(chatId);
    }
  });
});
