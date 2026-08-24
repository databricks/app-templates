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
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { expect, test } from '../fixtures';
import { sendChatAndGetMessageId } from '../helpers';
import { captureRemoteTraceManifest } from '../../server/src/lib/mlflow-trace-manifest';

const MOCK_TRACE_ID = 'mock-mlflow-trace-id';
const MOCK_ASSESSMENT_ID = `mock-assessment-${MOCK_TRACE_ID}`;

const TEST_MESSAGE = {
  id: generateUUID(),
  role: 'user',
  parts: [{ type: 'text', text: 'Why is the sky blue?' }],
};

test.describe('/api/chat — trace ID capture via x-mlflow-return-trace-id header (API_PROXY mode)', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(() => {
    for (const destination of [
      process.env.TRACE_CONFORMANCE_MANIFEST,
      process.env.TRACE_CONFORMANCE_FAILURE_MANIFEST,
    ]) {
      if (destination) rmSync(destination, { force: true });
    }
  });
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
    if (process.env.TRACE_CONFORMANCE_MANIFEST) {
      expect(existsSync(process.env.TRACE_CONFORMANCE_MANIFEST)).toBe(true);
      const manifest = JSON.parse(
        readFileSync(process.env.TRACE_CONFORMANCE_MANIFEST, 'utf8'),
      );
      expect(manifest.trace_id).toBe(MOCK_TRACE_ID);
      expect(manifest.spans.map((span: { name: string }) => span.name)).toEqual(
        ['remote.agent', 'remote.model'],
      );
    }
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

  test('captures an injected remote failure manifest with canonical partial output', async () => {
    const destination = process.env.TRACE_CONFORMANCE_FAILURE_MANIFEST;
    test.skip(
      !destination,
      'failure manifest capture is enabled by the conformance runner',
    );
    if (!destination) return;

    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          trace: {
            trace_info: {
              trace_id: 'mock-mlflow-failure-trace-id',
              app_id: 'e2e-chatbot-app-next',
              user_id: 'test-user',
              session_id: 'test-session',
            },
            data: {
              spans: [
                {
                  span_id: 'root-span',
                  parent_span_id: null,
                  name: 'remote.agent',
                  span_type: 'AGENT',
                  inputs: { input: 'inject failure' },
                  outputs: {
                    partial_output: { text: 'partial' },
                    error: 'injected failure',
                  },
                  status: { status_code: 'ERROR' },
                  latency_ms: 2,
                  attributes: {
                    'mlflow.trace.tokenUsage': {
                      input_tokens: 4,
                      output_tokens: 2,
                      total_tokens: 6,
                    },
                    'appkit.cost_available': false,
                    'appkit.app.name': 'e2e-chatbot-app-next',
                    'mlflow.trace.user': 'test-user',
                    'mlflow.trace.session': 'test-session',
                  },
                },
                {
                  span_id: 'model-span',
                  parent_span_id: 'root-span',
                  name: 'remote.model',
                  span_type: 'CHAT_MODEL',
                  inputs: { messages: ['inject failure'] },
                  outputs: {
                    partial_output: { text: 'partial' },
                    error: 'injected failure',
                  },
                  status: { status_code: 'ERROR' },
                  latency_ms: 1,
                  attributes: {
                    'mlflow.chat.model': 'test-model',
                    'mlflow.chat.provider': 'databricks',
                    'mlflow.chat.tokenUsage': {
                      input_tokens: 4,
                      output_tokens: 2,
                      total_tokens: 6,
                    },
                    'appkit.cost_available': false,
                  },
                },
              ],
            },
          },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failure trace fixture server did not bind');
    }
    try {
      await captureRemoteTraceManifest({
        traceId: 'mock-mlflow-failure-trace-id',
        hostUrl: `http://127.0.0.1:${address.port}`,
        token: 'test-token',
        destination,
        template:
          process.env.TRACE_CONFORMANCE_TEMPLATE ?? 'e2e-chatbot-app-next',
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }

    const manifest = JSON.parse(readFileSync(destination, 'utf8'));
    expect(
      manifest.spans.every(
        (span: { status: string }) => span.status === 'ERROR',
      ),
    ).toBe(true);
    expect(
      manifest.spans.every(
        (span: { outputs: { partial_output?: unknown } }) =>
          span.outputs.partial_output,
      ),
    ).toBe(true);
  });
});
