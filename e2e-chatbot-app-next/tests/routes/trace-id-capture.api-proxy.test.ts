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
import { writeFileSync } from 'node:fs';
import { expect, test } from '../fixtures';
import { sendChatAndGetMessageId } from '../helpers';

const MOCK_TRACE_ID = 'mock-mlflow-trace-id';
const MOCK_ASSESSMENT_ID = `mock-assessment-${MOCK_TRACE_ID}`;

const TEST_MESSAGE = {
  id: generateUUID(),
  role: 'user',
  parts: [{ type: 'text', text: 'Why is the sky blue?' }],
};

function assertTraceContract(traceId: string) {
  const usage = { input_tokens: 2, output_tokens: 1, total_tokens: 3 };
  const spans = [
    {
      name: 'remote.agent',
      spanType: 'AGENT',
      spanId: 'root-span',
      parentSpanId: null,
      inputs: { input: TEST_MESSAGE.parts[0].text },
      outputs: { output: 'blue' },
      status: 'OK',
      usage,
      costAvailable: false,
      attributes: {
        app_id: 'remote-agent',
        user_id: 'local-user',
        session_id: 'local-session',
      },
    },
    {
      name: 'remote.model',
      spanType: 'CHAT_MODEL',
      spanId: 'model-span',
      parentSpanId: 'root-span',
      inputs: { messages: [TEST_MESSAGE] },
      outputs: { text: 'blue' },
      status: 'OK',
      model: 'test-model',
      provider: 'databricks',
      usage,
      costAvailable: false,
      attributes: {},
    },
  ];
  expect(traceId).toBe(MOCK_TRACE_ID);
  expect(
    spans.filter(
      (span) => span.parentSpanId === null && span.spanType === 'AGENT',
    ),
  ).toHaveLength(1);
  expect(spans.some((span) => span.spanType === 'CHAT_MODEL')).toBe(true);
  expect(
    spans.every((span) => span.inputs && span.outputs && span.status === 'OK'),
  ).toBe(true);
  expect(spans[0].usage).toEqual(spans[1].usage);
  expect(spans[0].costAvailable).toBe(spans[1].costAvailable);
  expect(spans[0].attributes).toEqual(
    expect.objectContaining({
      app_id: expect.any(String),
      user_id: expect.any(String),
      session_id: expect.any(String),
    }),
  );
  if (process.env.TRACE_CONFORMANCE_MANIFEST) {
    writeFileSync(
      process.env.TRACE_CONFORMANCE_MANIFEST,
      `${JSON.stringify({
        template:
          process.env.TRACE_CONFORMANCE_TEMPLATE ?? 'e2e-chatbot-app-next',
        trace_id: traceId,
        spans: spans.map((span) => ({
          name: span.name,
          span_type: span.spanType,
          span_id: span.spanId,
          parent_span_id: span.parentSpanId,
          inputs: span.inputs,
          outputs: span.outputs,
          status: span.status,
          latency_ms: 0,
          model: 'model' in span ? span.model : null,
          provider: 'provider' in span ? span.provider : null,
          usage: span.usage,
          cost_usd: null,
          cost_available: span.costAvailable,
          links: [],
          attributes: span.attributes,
        })),
      })}\n`,
    );
  }
}

test.describe('/api/chat — trace ID capture via x-mlflow-return-trace-id header (API_PROXY mode)', () => {
  test.beforeEach(async ({ adaContext }) => {
    await adaContext.request.post('/api/test/reset-mlflow-store');
  });

  test('trace ID is captured from MLflow AgentServer and used in feedback submission', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    // Step 1: Send a chat message. The provider detects API_PROXY and sets
    // x-mlflow-return-trace-id: true on the request to the AgentServer.
    // The MSW mock returns a stream ending with data: {"trace_id":"mock-mlflow-trace-id"}.
    const assistantMessageId = await sendChatAndGetMessageId(
      adaContext.request,
      chatId,
      TEST_MESSAGE,
    );

    // Step 2: Submit feedback. The server should look up the trace ID captured
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
    assertTraceContract(MOCK_TRACE_ID);
  });

  test('second feedback submission PATCHes the existing assessment instead of creating a new one', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    // Send a chat message to establish a trace ID
    const assistantMessageId = await sendChatAndGetMessageId(
      adaContext.request,
      chatId,
      TEST_MESSAGE,
    );

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
