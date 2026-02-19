/**
 * Text streaming integration tests.
 *
 * These tests verify that the /api/chat endpoint correctly streams text when
 * the Responses API returns multiple text-delta events (real Databricks behavior).
 *
 * The critical bug this catches: when raw chunks are interleaved with text-delta
 * chunks in the provider stream, the delta-boundary transformer used to inject a
 * premature text-end after each raw chunk, then skip all subsequent text-deltas
 * via deduplication — resulting in empty text in the UI.
 *
 * These tests use the existing MSW mock (mockResponsesApiMultiDeltaTextStream)
 * which splits the response into per-word deltas, matching real API behavior.
 */

import { generateUUID } from '@chat-template/core';
import { expect, test } from '../fixtures';

const CHAT_MODEL = 'chat-model';

/** Parse SSE lines from a raw stream body, returning only `data:` payloads. */
function parseSSELines(body: string): Array<{ raw: string; json: unknown }> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => {
      const raw = line.slice(6);
      try {
        return { raw, json: JSON.parse(raw) };
      } catch {
        return { raw, json: null };
      }
    });
}

test.describe('/api/chat — text streaming (Responses API multi-delta)', () => {
  test('stream contains text-start, non-empty text-delta chunks, and text-end', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    const response = await adaContext.request.post('/api/chat', {
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

    expect(response.status()).toBe(200);
    const body = await response.text();
    const parts = parseSSELines(body);

    // Log for debugging
    console.log(
      '[text-streaming] SSE parts:',
      parts.map((p) => p.raw),
    );

    const types = parts.map((p) => (p.json as any)?.type);

    // Must have text-start
    expect(types).toContain('text-start');

    // Must have text-end
    expect(types).toContain('text-end');

    // Must have at least one text-delta with non-empty delta
    const textDeltas = parts.filter((p) => (p.json as any)?.type === 'text-delta');
    expect(textDeltas.length).toBeGreaterThan(0);

    const nonEmptyDeltas = textDeltas.filter(
      (p) => typeof (p.json as any)?.delta === 'string' && (p.json as any).delta.length > 0,
    );
    expect(
      nonEmptyDeltas.length,
      `Expected at least one text-delta with non-empty delta, but got: ${JSON.stringify(textDeltas.map((p) => p.raw))}`,
    ).toBeGreaterThan(0);

    // The concatenated deltas must equal the full expected text
    const fullText = textDeltas
      .map((p) => (p.json as any)?.delta ?? '')
      .join('');
    expect(fullText).toBe("It's just blue duh!");
  });

  test('text-start appears before any text-delta in the stream', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    const response = await adaContext.request.post('/api/chat', {
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

    expect(response.status()).toBe(200);
    const body = await response.text();
    const parts = parseSSELines(body);
    const types = parts.map((p) => (p.json as any)?.type);

    const textStartIdx = types.indexOf('text-start');
    const firstTextDeltaIdx = types.indexOf('text-delta');

    expect(textStartIdx).toBeGreaterThanOrEqual(0);
    expect(firstTextDeltaIdx).toBeGreaterThan(textStartIdx);
  });

  test('each text-delta has the same id as text-start (no broken boundary)', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    const response = await adaContext.request.post('/api/chat', {
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

    expect(response.status()).toBe(200);
    const body = await response.text();
    const parts = parseSSELines(body);

    const textStart = parts.find((p) => (p.json as any)?.type === 'text-start');
    expect(textStart).toBeDefined();
    const startId = (textStart?.json as any).id;

    const textDeltas = parts.filter((p) => (p.json as any)?.type === 'text-delta');
    for (const delta of textDeltas) {
      expect((delta.json as any).id).toBe(startId);
    }

    // Crucially: there must only be ONE text-start (no broken boundary = no multiple starts)
    const textStartCount = parts.filter(
      (p) => (p.json as any)?.type === 'text-start',
    ).length;
    expect(
      textStartCount,
      'Should have exactly one text-start. Multiple text-starts indicate the boundary transformer is incorrectly splitting the stream.',
    ).toBe(1);
  });
});
