import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  spans: [] as Array<any>,
  active: [] as Array<any>,
  route: undefined as undefined | ((req: any, res: any) => Promise<void>),
  responseStream: undefined as ReadableStream | undefined,
  queries: [] as Array<{ text: string; params?: unknown[] }>,
  streamOptions: undefined as any,
  createAppConfig: undefined as any,
  streamFailure: undefined as
    | undefined
    | { error: Error; usage: Record<string, unknown>; response: Record<string, unknown> },
  throwOnTelemetry: false,
}));

vi.mock('@opentelemetry/api', () => {
  let spanCounter = 0;
  class TestSpan {
    name: string;
    parent?: TestSpan;
    attributes: Record<string, unknown>;
    status?: unknown;
    exceptions: string[] = [];
    ended = false;
    traceId: string;
    spanId: string;

    constructor(name: string, options: any, parent?: TestSpan) {
      this.name = name;
      this.parent = parent;
      this.attributes = { ...(options?.attributes ?? {}) };
      this.traceId = parent?.traceId ?? '1234567890abcdef1234567890abcdef';
      this.spanId = (++spanCounter).toString(16).padStart(16, '0');
      state.spans.push(this);
    }
    setAttribute(key: string, value: unknown) {
      this.attributes[key] = value;
      if (state.throwOnTelemetry) throw new Error('exporter unavailable');
      return this;
    }
    setAttributes(values: Record<string, unknown>) {
      Object.assign(this.attributes, values);
      if (state.throwOnTelemetry) throw new Error('exporter unavailable');
      return this;
    }
    setStatus(status: unknown) {
      this.status = status;
      if (state.throwOnTelemetry) throw new Error('exporter unavailable');
      return this;
    }
    recordException(error: unknown) {
      this.exceptions.push(String(error));
      if (state.throwOnTelemetry) throw new Error('exporter unavailable');
    }
    spanContext() {
      return { traceId: this.traceId, spanId: this.spanId, traceFlags: 1 };
    }
    end() {
      if (state.throwOnTelemetry) throw new Error('exporter unavailable');
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
      with: (_ctx: any, fn: () => unknown) => fn(),
    },
    trace: {
      getTracer: () => tracer,
      setSpan: (_ctx: any, span: TestSpan) => ({ span }),
      wrapSpanContext: () => new TestSpan('otel.noop', {}, undefined),
    },
    INVALID_SPAN_CONTEXT: {
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: 0,
    },
    SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  };
});

vi.mock('@databricks/appkit', () => ({
  createApp: vi.fn(async (config: unknown) => {
    state.createAppConfig = config;
    return {};
  }),
  lakebase: vi.fn(() => ({ name: 'lakebase' })),
  server: vi.fn(() => ({ name: 'server' })),
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

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => ({ chat: (model: string) => ({ modelId: model }) }),
}));

vi.mock('@databricks/sdk-experimental', () => ({
  Config: class {
    async ensureResolved() {}
    async authenticate(headers: Headers) {
      headers.set('Authorization', 'Bearer test-token');
    }
  },
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: vi.fn((options: any) => {
      state.streamOptions = options;
      return {
        toUIMessageStream() {
          let emitted = false;
          return new ReadableStream({
            async pull(controller) {
              if (emitted) return;
              emitted = true;
              if (state.streamFailure) {
                options.onChunk?.({
                  chunk: { type: 'text-delta', text: 'Partial grounded answer' },
                });
                controller.enqueue({ type: 'text-start', id: 'answer' });
                controller.enqueue({
                  type: 'text-delta',
                  id: 'answer',
                  delta: 'Partial grounded answer',
                });
                options.onChunk?.({
                  chunk: {
                    type: 'finish',
                    finishReason: 'error',
                    totalUsage: state.streamFailure.usage,
                    response: state.streamFailure.response,
                  },
                });
                state.throwOnTelemetry = true;
                await options.onError?.({
                  error: state.streamFailure.error,
                  usage: state.streamFailure.usage,
                  response: state.streamFailure.response,
                  finishReason: 'error',
                });
                controller.error(state.streamFailure.error);
                return;
              }
              options.onChunk?.({
                chunk: { type: 'text-delta', text: 'Grounded answer' },
              });
              controller.enqueue({ type: 'text-start', id: 'answer' });
              controller.enqueue({
                type: 'text-delta',
                id: 'answer',
                delta: 'Grounded answer',
              });
              controller.enqueue({ type: 'text-end', id: 'answer' });
              await options.onFinish?.({
                text: 'Grounded answer',
                finishReason: 'stop',
                usage: {
                  inputTokens: 21,
                  outputTokens: 3,
                  totalTokens: 24,
                  inputTokenDetails: {
                    cacheReadTokens: 5,
                    cacheWriteTokens: 2,
                  },
                },
                response: {
                  modelId: 'databricks-gpt-5-4-mini',
                  body: { usage: { cost_usd: 0.006 } },
                },
              });
              controller.enqueue({ type: 'finish', finishReason: 'stop' });
              controller.close();
            },
          });
        },
      };
    }),
    pipeUIMessageStreamToResponse: vi.fn(({ stream, response }: { stream: ReadableStream; response: any }) => {
      state.responseStream = stream;
      response.headersSent = true;
    }),
  };
});

import { setupChatRoutes } from '../routes/chat-routes';
import { safeTraceValue, validateTracingEnvironment } from '../lib/tracing';

function attribute(span: any, key: string) {
  const value = span.attributes[key];
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function consume(stream: ReadableStream | undefined) {
  expect(stream).toBeDefined();
  const chunks = [];
  const reader = stream!.getReader();
  for (let item = await reader.read(); !item.done; item = await reader.read()) {
    chunks.push(item.value);
  }
  return chunks;
}

describe('RAG chat tracing', () => {
  beforeEach(() => {
    state.spans.length = 0;
    state.active.length = 0;
    state.route = undefined;
    state.responseStream = undefined;
    state.queries.length = 0;
    state.streamOptions = undefined;
    state.createAppConfig = undefined;
    state.streamFailure = undefined;
    state.throwOnTelemetry = false;
    process.env.DATABRICKS_TOKEN = 'credential-must-not-be-captured';
    process.env.DATABRICKS_WORKSPACE_ID = '123';
    process.env.DATABRICKS_HOST = 'workspace.cloud.databricks.com';
    process.env.DATABRICKS_APP_NAME = 'rag-chat-test';
  });

  test('bounded capture redacts credentials and retains digest metadata', () => {
    const captured = safeTraceValue({
      authorization: 'Bearer never-export-this',
      content: `api_key=also-secret ${'界'.repeat(30_000)}`,
    }) as Record<string, unknown>;

    expect(captured).toEqual({
      truncated: true,
      originalBytes: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      preview: expect.any(String),
    });
    expect(JSON.stringify(captured)).not.toContain('never-export-this');
    expect(JSON.stringify(captured)).not.toContain('also-secret');
  });

  test('natural-language credentials are fully redacted', () => {
    const captured = safeTraceValue({
      content: "The customer's password is hunter2 and their api key is live-secret.",
    });

    expect(captured).toEqual({
      content: "The customer's password is [REDACTED] and their api key is [REDACTED]",
    });
    expect(JSON.stringify(captured)).not.toContain('hunter2');
    expect(JSON.stringify(captured)).not.toContain('live-secret');
  });

  test('missing UC tracing configuration fails synchronously before AppKit startup', () => {
    expect(() => validateTracingEnvironment({})).toThrow(
      /Missing required tracing configuration: MLFLOW_EXPERIMENT_ID.*MLFLOW_OTEL_SPANS_TABLE/
    );
    expect(state.createAppConfig).toBeUndefined();
  });

  test('real route emits the semantic tree, response trace ID, exact usage, and persistence', async () => {
    const appkit = {
      lakebase: {
        query: vi.fn(async (text: string, params?: unknown[]) => {
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
          if (text.includes('FROM chat.chats')) {
            return { rows: [{ id: 'chat-1', user_id: 'ada@example.com' }] };
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
        }),
      },
      server: {
        extend(fn: (app: any) => void) {
          fn({
            post(path: string, handler: (req: any, res: any) => Promise<void>) {
              if (path === '/api/chat') state.route = handler;
            },
          });
        },
      },
    };
    setupChatRoutes(appkit);
    expect(state.route).toBeDefined();

    const headers: Record<string, string> = {};
    const response = {
      headersSent: false,
      statusCode: 200,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: vi.fn(),
    };
    await state.route!(
      {
        body: {
          chatId: 'chat-1',
          messages: [
            {
              id: 'user-message',
              role: 'user',
              parts: [{ type: 'text', text: 'What is a lakehouse?' }],
            },
          ],
        },
        header(name: string) {
          const requestHeaders: Record<string, string> = {
            'x-forwarded-email': 'ada@example.com',
            'x-request-id': 'request-789',
          };
          return requestHeaders[name.toLowerCase()];
        },
      },
      response
    );
    const chunks = await consume(state.responseStream);

    expect(response.statusCode).toBe(200);
    expect(headers['x-mlflow-trace-id']).toBe('1234567890abcdef1234567890abcdef');
    expect(chunks).toContainEqual({
      type: 'data-traceId',
      data: '1234567890abcdef1234567890abcdef',
      transient: false,
    });
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'data-sources' }));

    const root = state.spans.find((span) => span.name === 'rag-chat.request');
    expect(root).toBeDefined();
    expect(root.attributes['mlflow.spanType']).toBe('AGENT');
    expect(root.attributes['mlflow.trace.session']).toBe('chat-1');
    expect(root.attributes['mlflow.trace.user']).toBe('ada@example.com');
    expect(root.attributes['appkit.request.id']).toBe('request-789');
    expect(root.attributes['appkit.app.name']).toBe('rag-chat-test');

    const children = state.spans.filter((span) => span.parent === root);
    expect(children.map((span) => span.attributes['mlflow.spanType'])).toEqual([
      'MEMORY',
      'EMBEDDING',
      'RETRIEVER',
      'CHAT_MODEL',
      'MEMORY',
    ]);
    const [, embedding, retriever, model, persisted] = children;
    expect(attribute(embedding, 'mlflow.spanInputs')).toEqual({
      text: 'What is a lakehouse?',
    });
    expect(attribute(embedding, 'appkit.usage')).toEqual({
      inputTokens: 4,
      outputTokens: 0,
      totalTokens: 4,
      costAvailable: false,
    });
    expect(embedding.attributes['mlflow.spanType']).toBe('EMBEDDING');
    expect(attribute(retriever, 'mlflow.spanOutputs')).toEqual([
      {
        id: 'doc-1',
        content: 'Lakehouse context',
        score: 0.91,
        metadata: { source: 'docs' },
      },
    ]);
    expect(attribute(model, 'mlflow.spanInputs')).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ content: 'What is a lakehouse?' }),
        ]),
      })
    );
    expect(attribute(model, 'mlflow.spanOutputs')).toEqual({
      text: 'Grounded answer',
      partial: false,
    });
    expect(attribute(model, 'appkit.usage')).toEqual({
      inputTokens: 21,
      outputTokens: 3,
      totalTokens: 24,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 2,
      costAvailable: true,
      costUsd: 0.006,
    });
    expect(model.attributes['appkit.ttft_ms']).toEqual(expect.any(Number));
    expect(model.attributes['appkit.stream_duration_ms']).toEqual(expect.any(Number));
    expect(attribute(persisted, 'mlflow.spanOutputs')).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'Grounded answer' })
    );
    expect(
      state.queries.some(
        ({ text, params }) =>
          text.includes('INSERT INTO chat.messages') && params?.[1] === 'assistant' && params?.[2] === 'Grounded answer'
      )
    ).toBe(true);
    expect(JSON.stringify(state.spans)).not.toContain('credential-must-not-be-captured');
    expect(children.every((span) => span.ended)).toBe(true);
    expect(root.ended).toBe(true);
  });

  test('stream failure retains partial output, usage, cost, persistence, and exporter isolation', async () => {
    state.streamFailure = {
      error: new Error('provider stream failed'),
      usage: {
        inputTokens: 13,
        outputTokens: 4,
        totalTokens: 17,
        inputTokenDetails: { cacheReadTokens: 2 },
      },
      response: {
        modelId: 'databricks-gpt-5-4-mini',
        body: { usage: { cost_usd: 0.004 } },
      },
    };
    const appkit = {
      lakebase: {
        query: vi.fn(async (text: string, params?: unknown[]) => {
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
          if (text.includes('FROM chat.chats')) {
            return { rows: [{ id: 'chat-1', user_id: 'ada@example.com' }] };
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
        }),
      },
      server: {
        extend(fn: (app: any) => void) {
          fn({
            post(path: string, handler: (req: any, res: any) => Promise<void>) {
              if (path === '/api/chat') state.route = handler;
            },
          });
        },
      },
    };
    setupChatRoutes(appkit);

    const response = {
      headersSent: false,
      statusCode: 200,
      setHeader() {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: vi.fn(),
    };
    await state.route!(
      {
        body: {
          chatId: 'chat-1',
          messages: [
            {
              id: 'user-message',
              role: 'user',
              parts: [{ type: 'text', text: 'What is a lakehouse?' }],
            },
          ],
        },
        header(name: string) {
          return name.toLowerCase() === 'x-forwarded-email' ? 'ada@example.com' : 'request-error';
        },
      },
      response
    );

    const chunks = await consume(state.responseStream);
    expect(chunks).toContainEqual({
      type: 'error',
      errorText: 'provider stream failed',
    });

    const root = state.spans.find((span) => span.name === 'rag-chat.request');
    const model = state.spans.find((span) => span.name === 'rag.generate');
    const persistence = state.spans.find((span) => span.name === 'rag.memory.assistant');
    expect(attribute(model, 'mlflow.spanOutputs')).toEqual({
      text: 'Partial grounded answer',
      partial: true,
    });
    expect(attribute(model, 'appkit.usage')).toEqual({
      inputTokens: 13,
      outputTokens: 4,
      totalTokens: 17,
      cacheReadInputTokens: 2,
      costAvailable: true,
      costUsd: 0.004,
    });
    expect(model.attributes['appkit.cost_usd']).toBe(0.004);
    expect(persistence).toBeDefined();
    expect(attribute(persistence, 'mlflow.spanOutputs')).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'Partial grounded answer',
      })
    );
    expect(
      state.queries.some(
        ({ text, params }) =>
          text.includes('INSERT INTO chat.messages') &&
          params?.[1] === 'assistant' &&
          params?.[2] === 'Partial grounded answer'
      )
    ).toBe(true);
    expect(attribute(root, 'mlflow.spanOutputs')).toEqual(
      expect.objectContaining({
        text: 'Partial grounded answer',
        partial: true,
        persisted: expect.objectContaining({
          role: 'assistant',
          content: 'Partial grounded answer',
        }),
        error: 'provider stream failed',
      })
    );
    expect(attribute(root, 'appkit.usage')).toEqual(attribute(model, 'appkit.usage'));
  });

  test('server passes the MLflow UC processor option to AppKit before startup', async () => {
    Object.assign(process.env, {
      MLFLOW_EXPERIMENT_ID: '123',
      MLFLOW_TRACING_SQL_WAREHOUSE_ID: '0123456789abcdef',
      MLFLOW_UC_CATALOG: 'main',
      MLFLOW_UC_SCHEMA: 'agent_traces',
      MLFLOW_UC_TABLE_PREFIX: 'rag_chat',
      MLFLOW_OTEL_SPANS_TABLE: 'main.agent_traces.rag_chat_otel_spans',
    });

    await import('../server');

    expect(state.createAppConfig).toEqual(expect.objectContaining({ telemetry: { mlflowUc: true } }));
    expect(state.createAppConfig.plugins).toHaveLength(2);
  });
});
