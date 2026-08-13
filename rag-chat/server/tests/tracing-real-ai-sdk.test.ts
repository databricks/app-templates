import type { LanguageModel } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

type LanguageModelV3 = Extract<LanguageModel, { readonly specificationVersion: 'v3' }>;

const state = vi.hoisted(() => ({
  spans: [] as Array<any>,
  active: [] as Array<any>,
  model: undefined as LanguageModelV3 | undefined,
  queries: [] as Array<{ text: string; params?: unknown[] }>,
}));

vi.mock('@opentelemetry/api', () => {
  let spanCounter = 0;
  class TestSpan {
    name: string;
    parent?: TestSpan;
    attributes: Record<string, unknown>;
    status?: unknown;
    exceptions: unknown[] = [];
    ended = false;
    traceId: string;
    spanId: string;

    constructor(name: string, options?: any, parent?: TestSpan) {
      this.name = name;
      this.parent = parent;
      this.attributes = { ...(options?.attributes ?? {}) };
      this.traceId = parent?.traceId ?? '1234567890abcdef1234567890abcdef';
      this.spanId = (++spanCounter).toString(16).padStart(16, '0');
      state.spans.push(this);
    }
    setAttribute(key: string, value: unknown) {
      this.attributes[key] = value;
      return this;
    }
    setAttributes(values: Record<string, unknown>) {
      Object.assign(this.attributes, values);
      return this;
    }
    setStatus(status: unknown) {
      this.status = status;
      return this;
    }
    recordException(error: unknown) {
      this.exceptions.push(error);
    }
    spanContext() {
      return { traceId: this.traceId, spanId: this.spanId, traceFlags: 1 };
    }
    end() {
      this.ended = true;
    }
  }

  const tracer = {
    startSpan(name: string, options?: any, parentContext?: any) {
      return new TestSpan(name, options, parentContext?.span);
    },
    startActiveSpan(name: string, options: any, callback: (span: TestSpan) => any) {
      const span = new TestSpan(name, options, state.active[state.active.length - 1]);
      state.active.push(span);
      try {
        const result = callback(span);
        if (result && typeof result.then === 'function') {
          return result.finally(() => state.active.pop());
        }
        state.active.pop();
        return result;
      } catch (error) {
        state.active.pop();
        throw error;
      }
    },
  };

  return {
    context: {
      active: () => ({ span: state.active[state.active.length - 1] }),
      with: (_context: unknown, fn: () => unknown) => fn(),
    },
    trace: {
      getTracer: () => tracer,
      setSpan: (_context: unknown, span: TestSpan) => ({ span }),
      wrapSpanContext: () => new TestSpan('otel.noop'),
    },
    INVALID_SPAN_CONTEXT: {
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: 0,
    },
    SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  };
});

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => ({
    chat: () => {
      if (!state.model) throw new Error('test provider is not configured');
      return state.model;
    },
  }),
}));

vi.mock('@databricks/appkit', () => ({
  getWorkspaceClient: () => ({
    servingEndpoints: {
      query: vi.fn(async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        model: 'databricks-gte-large-en',
        usage: { prompt_tokens: 4, total_tokens: 4 },
      })),
    },
  }),
}));

vi.mock('@databricks/sdk-experimental', () => ({
  Config: class {
    async ensureResolved() {}
    async authenticate(headers: Headers) {
      headers.set('Authorization', 'Bearer test-token');
    }
  },
}));

import { setRagContext, startRagRequest } from '../lib/tracing';

function providerThatErrors(error: unknown): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test-provider',
    modelId: 'databricks-gpt-5-4-mini',
    supportedUrls: {},
    async doGenerate() {
      throw new Error('not used by this test');
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'response-metadata',
              modelId: 'databricks-gpt-5-4-mini',
            });
            controller.enqueue({ type: 'text-start', id: 'answer' });
            controller.enqueue({
              type: 'text-delta',
              id: 'answer',
              delta: 'Partial grounded answer',
            });
            controller.enqueue({ type: 'error', error });
            controller.close();
          },
        }),
      };
    },
  };
}

function attribute(span: any, key: string) {
  const value = span.attributes[key];
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function consume(stream: ReadableStream) {
  const chunks = [];
  const reader = stream.getReader();
  for (let item = await reader.read(); !item.done; item = await reader.read()) {
    chunks.push(item.value);
  }
  return chunks;
}

describe('RAG tracing through the installed AI SDK', () => {
  beforeEach(() => {
    state.spans.length = 0;
    state.active.length = 0;
    state.queries.length = 0;
    process.env.DATABRICKS_TOKEN = 'test-token';
    process.env.DATABRICKS_WORKSPACE_ID = '123';
    process.env.DATABRICKS_HOST = 'workspace.cloud.databricks.com';

    setRagContext({
      lakebase: {
        async query(text: string, params?: unknown[]) {
          state.queries.push({ text, params });
          if (text.includes('INSERT INTO chat.messages')) {
            return {
              rows: [
                {
                  id: `message-${state.queries.length}`,
                  chat_id: 'chat-1',
                  role: params?.[1],
                  content: params?.[2],
                },
              ],
            };
          }
          if (text.includes('FROM rag.documents')) {
            return {
              rows: [
                {
                  id: 'doc-1',
                  content: 'Lakehouse context',
                  similarity: 0.91,
                  metadata: { source: 'docs' },
                },
              ],
            };
          }
          return { rows: [] };
        },
      },
      server: { extend() {} },
    });
  });

  test('retains partial usage and cost from the error object passed by real streamText', async () => {
    const error = Object.assign(new Error('provider stream failed'), {
      usage: {
        inputTokens: { total: 13, noCache: 11, cacheRead: 2, cacheWrite: 1 },
        outputTokens: { total: 4, text: 4, reasoning: undefined },
      },
      response: {
        modelId: 'databricks-gpt-5-4-mini',
        body: { usage: { cost_usd: 0.004 } },
      },
    });
    state.model = providerThatErrors(error);

    const response = await startRagRequest({
      chatId: 'chat-1',
      userId: 'ada@example.com',
      messages: [
        {
          id: 'user-message',
          role: 'user',
          parts: [{ type: 'text', text: 'What is a lakehouse?' }],
        },
      ],
    });
    const chunks = await consume(response.stream);

    expect(chunks).toContainEqual({
      type: 'error',
      errorText: 'provider stream failed',
    });
    const model = state.spans.find((span) => span.name === 'rag.generate');
    expect(attribute(model, 'mlflow.spanOutputs')).toEqual({
      text: 'Partial grounded answer',
      partial: true,
    });
    expect(attribute(model, 'appkit.usage')).toEqual({
      inputTokens: 13,
      outputTokens: 4,
      totalTokens: 17,
      cacheReadInputTokens: 2,
      cacheCreationInputTokens: 1,
      costAvailable: true,
      costUsd: 0.004,
    });
    expect(
      state.queries.some(
        ({ text, params }) =>
          text.includes('INSERT INTO chat.messages') &&
          params?.[1] === 'assistant' &&
          params?.[2] === 'Partial grounded answer'
      )
    ).toBe(true);
  });

  test('marks cost unavailable when a real streamText error has no usage metadata', async () => {
    state.model = providerThatErrors(new Error('plain provider failure'));

    const response = await startRagRequest({
      chatId: 'chat-1',
      userId: 'ada@example.com',
      messages: [
        {
          id: 'user-message',
          role: 'user',
          parts: [{ type: 'text', text: 'What is a lakehouse?' }],
        },
      ],
    });
    await consume(response.stream);

    const model = state.spans.find((span) => span.name === 'rag.generate');
    expect(attribute(model, 'appkit.usage')).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costAvailable: false,
    });
    expect(model.attributes['appkit.cost_usd']).toBeUndefined();
  });
});
