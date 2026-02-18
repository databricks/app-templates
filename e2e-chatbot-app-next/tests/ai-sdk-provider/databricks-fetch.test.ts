/**
 * Unit tests for the databricks_options injection in databricksFetch.
 *
 * The injection ensures every Responses API request includes
 * `databricks_options: { return_trace: true }`, which causes Databricks to
 * include a trace ID in the response. This trace ID is later used to submit
 * feedback to MLflow.
 *
 * @databricks/ai-sdk-provider v0.4.1 does not forward providerOptions to the
 * request body, so the injection is done at the custom fetch layer instead.
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

  test('injects { return_trace: true } when URL contains /responses and body has no databricks_options', async () => {
    await databricksFetch(RESPONSES_URL, {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-3', input: [] }),
    });

    expect(captured).toHaveLength(1);
    const sentBody = JSON.parse(captured[0].body as string);
    expect(sentBody.databricks_options).toEqual({ return_trace: true });
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
