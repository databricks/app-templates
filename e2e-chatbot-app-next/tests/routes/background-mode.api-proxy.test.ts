/**
 * Integration tests for background mode feature in API_PROXY mode.
 *
 * These tests run in the routes-api-proxy project (port 3003) which has
 * API_PROXY set, enabling USE_LONG_RUNNING_MODE. They verify:
 * - backgroundModeAvailable config flag is true when API_PROXY is set
 * - backgroundMode field controls whether background:true is injected
 * - Legacy useBackgroundMode field still works
 * - Schema validation rejects invalid backgroundMode values
 * - SSE stream is valid when backgroundMode is set
 */

import { generateUUID } from '@chat-template/core';
import { expect, test } from '../fixtures';
import { parseSSEPayloads } from '../helpers';
import type { CapturedRequest } from '../api-mocking/api-mock-handlers';

const TEST_MESSAGE = {
  id: generateUUID(),
  role: 'user',
  parts: [{ type: 'text', text: 'Why is the sky blue?' }],
};

test.describe('/api/config — backgroundModeAvailable (API_PROXY mode)', () => {
  test('backgroundModeAvailable is true when API_PROXY is set', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.get('/api/config');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.features).toHaveProperty('backgroundModeAvailable');
    expect(data.features.backgroundModeAvailable).toBe(true);
  });
});

test.describe
  .serial('/api/chat — background mode injection (API_PROXY mode)', () => {
  test.beforeEach(async ({ adaContext }) => {
    await adaContext.request.post('/api/test/reset-captured-requests');
  });

  test('backgroundMode=streaming injects background:true into upstream request', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: { ...TEST_MESSAGE, id: generateUUID() },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
        backgroundMode: 'streaming',
      },
    });
    expect(response.status()).toBe(200);

    const capturedResponse = await adaContext.request.get(
      '/api/test/captured-requests',
    );
    const capturedRequests =
      (await capturedResponse.json()) as CapturedRequest[];

    // Find the request to the MLflow agent server (not title-generation)
    const agentRequest = capturedRequests.find((req) =>
      req.url.includes('mlflow-agent-server-mock'),
    );
    expect(agentRequest).toBeDefined();
    expect(agentRequest?.body?.background).toBe(true);
    expect(agentRequest?.body?.stream).toBe(true);
  });

  test('backgroundMode=direct does NOT inject background:true into upstream request', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: { ...TEST_MESSAGE, id: generateUUID() },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
        backgroundMode: 'direct',
      },
    });
    expect(response.status()).toBe(200);

    const capturedResponse = await adaContext.request.get(
      '/api/test/captured-requests',
    );
    const capturedRequests =
      (await capturedResponse.json()) as CapturedRequest[];

    const agentRequest = capturedRequests.find((req) =>
      req.url.includes('mlflow-agent-server-mock'),
    );
    expect(agentRequest).toBeDefined();
    expect(agentRequest?.body?.background).toBeUndefined();
  });

  test('default backgroundMode (omitted) injects background:true', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: { ...TEST_MESSAGE, id: generateUUID() },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });
    expect(response.status()).toBe(200);

    const capturedResponse = await adaContext.request.get(
      '/api/test/captured-requests',
    );
    const capturedRequests =
      (await capturedResponse.json()) as CapturedRequest[];

    const agentRequest = capturedRequests.find((req) =>
      req.url.includes('mlflow-agent-server-mock'),
    );
    expect(agentRequest).toBeDefined();
    expect(agentRequest?.body?.background).toBe(true);
    expect(agentRequest?.body?.stream).toBe(true);
  });

  test('legacy useBackgroundMode=false sends direct mode (no background:true)', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: { ...TEST_MESSAGE, id: generateUUID() },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
        useBackgroundMode: false,
      },
    });
    expect(response.status()).toBe(200);

    const capturedResponse = await adaContext.request.get(
      '/api/test/captured-requests',
    );
    const capturedRequests =
      (await capturedResponse.json()) as CapturedRequest[];

    const agentRequest = capturedRequests.find((req) =>
      req.url.includes('mlflow-agent-server-mock'),
    );
    expect(agentRequest).toBeDefined();
    expect(agentRequest?.body?.background).toBeUndefined();
  });

  test('chat returns valid SSE with backgroundMode=streaming', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: { ...TEST_MESSAGE, id: generateUUID() },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
        backgroundMode: 'streaming',
      },
    });
    expect(response.status()).toBe(200);

    const body = await response.text();
    const payloads = parseSSEPayloads(body);

    // Should have a start event with messageId
    const startEvent = payloads.find(
      (p) => (p as any)?.type === 'start' && (p as any)?.messageId,
    );
    expect(startEvent).toBeDefined();

    // Should have text content
    const textDeltas = payloads.filter(
      (p) => (p as any)?.type === 'text-delta',
    );
    expect(textDeltas.length).toBeGreaterThan(0);
  });
});

test.describe('/api/chat — backgroundMode schema validation (API_PROXY mode)', () => {
  test('invalid backgroundMode value is rejected', async ({ adaContext }) => {
    const chatId = generateUUID();
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: { ...TEST_MESSAGE, id: generateUUID() },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
        backgroundMode: 'invalid',
      },
    });
    expect(response.status()).toBe(400);
  });
});
