/**
 * End-to-end tests for the feedback feature against a live deployed Databricks App.
 *
 * Prerequisites:
 * - App deployed to Databricks Apps
 * - Databricks CLI configured (run `databricks auth login` first)
 * - DEPLOYED_APP_URL environment variable set to the app URL
 *
 * Run with:
 *   DEPLOYED_APP_URL=<your-app-url> npx playwright test --project=deployed
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { generateUUID } from '@chat-template/core';

function getAuthToken(): string {
  try {
    const output = execSync('databricks auth token --output json', {
      encoding: 'utf-8',
    });
    const parsed = JSON.parse(output);
    if (!parsed.access_token) {
      throw new Error('No access_token in databricks auth token output');
    }
    return parsed.access_token;
  } catch (err) {
    throw new Error(
      `Failed to get Databricks auth token. Ensure Databricks CLI is configured.\n${err}`,
    );
  }
}

async function verifyDeployedTraceInUc(traceId: string, token: string) {
  const required = [
    'DATABRICKS_HOST',
    'MLFLOW_EXPERIMENT_ID',
    'MLFLOW_TRACING_SQL_WAREHOUSE_ID',
    'MLFLOW_OTEL_SPANS_TABLE',
  ] as const;
  const missing = required.filter((name) => !process.env[name]);
  expect(missing, 'deployed trace verification environment').toEqual([]);
  const hostValue = process.env.DATABRICKS_HOST;
  const experimentId = process.env.MLFLOW_EXPERIMENT_ID;
  if (!hostValue || !experimentId) {
    throw new Error('deployed trace verification environment is incomplete');
  }
  const host = hostValue.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const traceResponse = await fetch(
    `${host}/api/3.0/mlflow/traces/${encodeURIComponent(traceId)}`,
    {
      headers,
    },
  );
  expect(traceResponse.ok).toBe(true);
  const trace = await traceResponse.json();
  const info = trace.trace?.trace_info ?? trace.trace?.info;
  expect(String(info?.trace_id)).toBe(traceId);
  expect(String(info?.experiment_id)).toBe(process.env.MLFLOW_EXPERIMENT_ID);
  const spans =
    trace.trace?.trace_data?.spans ?? trace.trace?.data?.spans ?? [];
  expect(
    spans.some((span: any) => span.attributes?.['mlflow.spanType'] === 'AGENT'),
  ).toBe(true);
  expect(
    spans.some((span: any) =>
      ['CHAT_MODEL', 'LLM'].includes(span.attributes?.['mlflow.spanType']),
    ),
  ).toBe(true);

  const experimentResponse = await fetch(
    `${host}/api/2.0/mlflow/experiments/get?experiment_id=${encodeURIComponent(experimentId)}`,
    { headers },
  );
  expect(experimentResponse.ok).toBe(true);
  const experiment = await experimentResponse.json();
  expect(
    experiment.experiment?.trace_location?.full_otel_spans_table_name,
  ).toBe(process.env.MLFLOW_OTEL_SPANS_TABLE);

  const response = await fetch(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      warehouse_id: process.env.MLFLOW_TRACING_SQL_WAREHOUSE_ID,
      statement:
        'SELECT trace_id, span_id, parent_span_id, name, attributes\n' +
        'FROM IDENTIFIER(:otel_spans_table)\n' +
        'WHERE trace_id = :trace_id\n' +
        'ORDER BY start_time_unix_nano',
      parameters: [
        {
          name: 'otel_spans_table',
          type: 'STRING',
          value: process.env.MLFLOW_OTEL_SPANS_TABLE,
        },
        { name: 'trace_id', type: 'STRING', value: traceId },
      ],
      wait_timeout: '50s',
    }),
  });
  expect(response.ok).toBe(true);
  let statement = await response.json();
  const deadline = Date.now() + 120_000;
  while (
    ['PENDING', 'RUNNING'].includes(statement.status?.state) &&
    Date.now() < deadline
  ) {
    expect(statement.statement_id).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const poll = await fetch(
      `${host}/api/2.0/sql/statements/${statement.statement_id}`,
      { headers },
    );
    expect(poll.ok).toBe(true);
    statement = await poll.json();
  }
  expect(statement.status?.state).toBe('SUCCEEDED');
  const ucSpanIds = (statement.result?.data_array ?? [])
    .map((row: unknown[]) => String(row[1]))
    .sort();
  const mlflowSpanIds = spans
    .map((span: any) => String(span.span_id ?? span.spanId))
    .sort();
  expect(ucSpanIds).toEqual(mlflowSpanIds);
}

/**
 * Parse SSE lines and return only the `data:` payloads as parsed objects.
 */
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

test.describe('Deployed app: feedback round-trip', () => {
  let token: string;

  test.beforeAll(() => {
    token = getAuthToken();
  });

  test('submit feedback and retrieve it via GET /api/feedback/chat/:chatId', async ({
    request,
  }) => {
    const chatId = generateUUID();

    // Send a chat message and capture the assistant message ID from the stream.
    const chatResponse = await request.post('/api/chat', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        id: chatId,
        message: {
          id: generateUUID(),
          role: 'user',
          parts: [{ type: 'text', text: 'Say "test" and nothing else.' }],
        },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });

    expect(
      chatResponse.status(),
      `POST /api/chat failed: ${await chatResponse.text()}`,
    ).toBe(200);

    const body = await chatResponse.text();
    const payloads = parseSSEPayloads(body);
    const startEvent = payloads.find(
      (p) => (p as any)?.type === 'start' && (p as any)?.messageId,
    ) as { type: string; messageId: string } | undefined;

    expect(
      startEvent?.messageId,
      'Expected a start SSE event with messageId',
    ).toBeTruthy();
    const assistantMessageId = startEvent?.messageId;
    const traceEvent = payloads.find(
      (p) => (p as any)?.type === 'data-traceId',
    ) as { type: string; data: string | null } | undefined;
    expect(
      traceEvent?.data,
      'Expected the deployed response to expose its MLflow trace ID',
    ).toBeTruthy();
    const deployedTraceId = traceEvent?.data;
    if (!deployedTraceId) {
      throw new Error('deployed response did not expose its MLflow trace ID');
    }
    await verifyDeployedTraceInUc(deployedTraceId, token);

    // Submit thumbs-up feedback for the assistant message.
    const feedbackResponse = await request.post('/api/feedback', {
      headers: { Authorization: `Bearer ${token}` },
      data: { messageId: assistantMessageId, feedbackType: 'thumbs_up' },
    });

    expect(
      feedbackResponse.status(),
      `POST /api/feedback failed: ${await feedbackResponse.text()}`,
    ).toBe(200);
    const feedbackBody = await feedbackResponse.json();
    expect(feedbackBody.success).toBe(true);
    // mlflowAssessmentId is present when the trace was captured by MLflow.
    expect(
      feedbackBody.mlflowAssessmentId,
      'Expected mlflowAssessmentId to be set after submitting feedback',
    ).toBeTruthy();

    // Retrieve feedback for the chat and verify the round-trip.
    const getChatFeedbackResponse = await request.get(
      `/api/feedback/chat/${chatId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(getChatFeedbackResponse.status()).toBe(200);
    const chatFeedback = await getChatFeedbackResponse.json();
    expect(chatFeedback).toHaveProperty(assistantMessageId);
    expect(chatFeedback[assistantMessageId].feedbackType).toBe('thumbs_up');
    expect(chatFeedback[assistantMessageId].messageId).toBe(assistantMessageId);
  });
});
