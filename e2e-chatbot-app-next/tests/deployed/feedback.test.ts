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
import { execSync } from 'child_process';
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
        message: { role: 'user', content: 'Say "test" and nothing else.' },
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

    expect(startEvent?.messageId, 'Expected a start SSE event with messageId').toBeTruthy();
    const assistantMessageId = startEvent!.messageId;

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
