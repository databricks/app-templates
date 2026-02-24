/**
 * Unit tests for databricksFetch.
 *
 * databricksFetch is the custom fetch layer used for all Databricks API calls.
 * It handles context injection (conversation_id, user_id) into request bodies.
 *
 * Note: `databricks_options.return_trace` is injected by the AI SDK provider
 * via providerOptions.databricks.databricksOptions in chat.ts, NOT here.
 */

import { expect, test } from '@playwright/test';
import { databricksFetch } from '@chat-template/ai-sdk-providers';

const RESPONSES_URL =
  'https://dummy.databricks.com/serving-endpoints/my-agent/responses';
const COMPLETIONS_URL =
  'https://dummy.databricks.com/serving-endpoints/my-model/chat/completions';

/** Creates a fake fetch that records every call's RequestInit. */
function makeMockFetch(
  captured: RequestInit[],
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (_input, init) => {
    captured.push(init ?? {});
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

test.describe('databricksFetch — databricks_options injection', () => {
  let captured: RequestInit[];
  let savedFetch: typeof globalThis.fetch;

  test.beforeEach(() => {
    captured = [];
    savedFetch = globalThis.fetch;
    (globalThis as any).fetch = makeMockFetch(captured);
  });

  test.afterEach(() => {
    (globalThis as any).fetch = savedFetch;
  });

  test('does not inject databricks_options (handled via providerOptions in chat.ts)', async () => {
    await databricksFetch(RESPONSES_URL, {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-3', input: [] }),
    });

    expect(captured).toHaveLength(1);
    const sentBody = JSON.parse(captured[0].body as string);
    // databricksFetch does not inject databricks_options; return_trace is
    // forwarded by the AI SDK provider via providerOptions.databricks.
    expect(sentBody.databricks_options).toBeUndefined();
    // Original fields must be preserved
    expect(sentBody.model).toBe('claude-3');
    expect(sentBody.input).toEqual([]);
  });

  test('does not override existing databricks_options', async () => {
    const existing = { return_trace: false, custom_field: 'preserved' };
    await databricksFetch(RESPONSES_URL, {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-3', databricks_options: existing }),
    });

    const sentBody = JSON.parse(captured[0].body as string);
    expect(sentBody.databricks_options).toEqual(existing);
  });

  test('does not inject databricks_options for chat/completions URLs', async () => {
    await databricksFetch(COMPLETIONS_URL, {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-3', messages: [] }),
    });

    const sentBody = JSON.parse(captured[0].body as string);
    expect(sentBody.databricks_options).toBeUndefined();
  });

  test('does not crash and still sends the request when no body is provided', async () => {
    await expect(
      databricksFetch(RESPONSES_URL, { method: 'POST' }),
    ).resolves.toBeDefined();
    expect(captured).toHaveLength(1);
  });

  test('still sends request unchanged when body cannot be parsed as JSON', async () => {
    await databricksFetch(RESPONSES_URL, {
      method: 'POST',
      body: 'not-valid-json',
    });

    expect(captured).toHaveLength(1);
    // Body is passed through unmodified when parsing fails
    expect(captured[0].body).toBe('not-valid-json');
  });
});
