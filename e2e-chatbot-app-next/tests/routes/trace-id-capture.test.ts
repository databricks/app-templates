/**
 * Integration tests verifying the end-to-end trace ID capture pipeline.
 *
 * Flow under test:
 *  1. chat.ts passes `providerOptions.databricks.databricksOptions.return_trace: true`
 *     to streamText(), which the provider forwards as `databricks_options.return_trace`
 *     in the Responses API request body.
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

const CHAT_MODEL = 'chat-model';
const MOCK_TRACE_ID = 'mock-trace-id-from-databricks';
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

test.describe('/api/chat — trace ID capture via providerOptions', () => {
  test('trace ID is captured and used in MLflow feedback submission', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    // Step 1: Send a chat message. providerOptions.databricks.databricksOptions
    // forwards return_trace: true in the Responses API request body, which
    // causes the MSW mock to include a trace ID in the response stream.
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
    // The 'start' event includes `messageId`, available in all modes.
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

    // Step 3: Submit feedback. The server should look up the trace ID that was
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
