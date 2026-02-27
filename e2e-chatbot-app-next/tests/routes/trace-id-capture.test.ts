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
import { sendChatAndGetMessageId } from '../helpers';

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

});
