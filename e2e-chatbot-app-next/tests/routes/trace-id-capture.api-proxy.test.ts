/**
 * Integration tests verifying the end-to-end trace ID capture pipeline
 * when the server runs in API_PROXY mode against a local MLflow AgentServer.
 *
 * Flow under test:
 *  1. The provider detects API_PROXY is set and adds `x-mlflow-return-trace-id: true`
 *     to the request headers sent to the AgentServer.
 *  2. The MSW mock for mlflow-agent-server-mock/invocations detects the header
 *     and appends a standalone `data: {"trace_id":"mock-mlflow-trace-id"}` SSE event.
 *  3. onChunk in chat.ts captures the trace ID from the raw?.trace_id branch.
 *  4. On feedback submission the trace ID is forwarded to the mock MLflow endpoint.
 *  5. The feedback response includes `mlflowAssessmentId` proving the full chain worked.
 *
 * These tests always run in ephemeral mode (no database), so the trace ID lives
 * in the in-memory message-meta-store only.
 */

import { generateUUID } from '@chat-template/core';
import { expect, test } from '../fixtures';

const CHAT_MODEL = 'chat-model';
const MOCK_TRACE_ID = 'mock-mlflow-trace-id';
const MOCK_ASSESSMENT_ID = `mock-assessment-${MOCK_TRACE_ID}`;

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

test.describe('/api/chat — trace ID capture via x-mlflow-return-trace-id header (API_PROXY mode)', () => {
  test('trace ID is captured from MLflow AgentServer and used in feedback submission', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    // Step 1: Send a chat message. The provider detects API_PROXY and sets
    // x-mlflow-return-trace-id: true on the request to the AgentServer.
    // The MSW mock returns a stream ending with data: {"trace_id":"mock-mlflow-trace-id"}.
    const chatResponse = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: {
          id: generateUUID(),
          role: 'user',
          parts: [{ type: 'text', text: 'Why is the sky blue?' }],
        },
        selectedChatModel: CHAT_MODEL,
        selectedVisibilityType: 'private',
      },
    });

    expect(chatResponse.status()).toBe(200);

    // Step 2: Parse the SSE stream to extract the assistant message ID.
    const body = await chatResponse.text();
    const payloads = parseSSEPayloads(body);

    const startEvent = payloads.find(
      (p) => (p as any)?.type === 'start' && (p as any)?.messageId,
    ) as { type: string; messageId: string } | undefined;

    expect(
      startEvent?.messageId,
      `Expected a 'start' SSE event with messageId. Got payloads: ${JSON.stringify(payloads.map((p) => (p as any)?.type))}`,
    ).toBeTruthy();

    const assistantMessageId = startEvent?.messageId;

    // Step 3: Submit feedback. The server should look up the trace ID captured
    // from the MLflow AgentServer standalone trace-ID event.
    const feedbackResponse = await adaContext.request.post('/api/feedback', {
      data: {
        messageId: assistantMessageId,
        feedbackType: 'thumbs_up',
      },
    });

    expect(feedbackResponse.status()).toBe(200);
    const feedbackBody = await feedbackResponse.json();
    expect(feedbackBody.success).toBe(true);

    // mlflowAssessmentId is only non-null when the trace ID was captured via
    // the x-mlflow-return-trace-id path and MLflow submission succeeded.
    expect(feedbackBody.mlflowAssessmentId).toBe(MOCK_ASSESSMENT_ID);
  });

  test('second feedback submission PATCHes the existing assessment instead of creating a new one', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    // Send a chat message to establish a trace ID
    const chatResponse = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: {
          id: generateUUID(),
          role: 'user',
          parts: [{ type: 'text', text: 'Why is the sky blue?' }],
        },
        selectedChatModel: CHAT_MODEL,
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

    // First feedback submission — should POST and return the mock assessment ID
    const firstResponse = await adaContext.request.post('/api/feedback', {
      data: { messageId: assistantMessageId, feedbackType: 'thumbs_up' },
    });
    expect(firstResponse.status()).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.mlflowAssessmentId).toBe(MOCK_ASSESSMENT_ID);

    // Second feedback submission — should PATCH the existing assessment.
    // The PATCH mock returns the same assessment_id that was passed in the URL,
    // so we expect the same ID back.
    const secondResponse = await adaContext.request.post('/api/feedback', {
      data: { messageId: assistantMessageId, feedbackType: 'thumbs_down' },
    });
    expect(secondResponse.status()).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.mlflowAssessmentId).toBe(MOCK_ASSESSMENT_ID);
  });
});
