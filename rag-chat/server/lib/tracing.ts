import { createHash, randomUUID } from 'node:crypto';
import { context, INVALID_SPAN_CONTEXT, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { createOpenAI } from '@ai-sdk/openai';
import { createUIMessageStream, streamText, type UIMessage } from 'ai';
import { Config } from '@databricks/sdk-experimental';
import type { Application } from 'express';
import { appendMessage, setupChatTables } from './chat-store';
import { generateEmbedding, generateEmbeddingWithMetadata } from './embeddings';
import { insertDocument, retrieveSimilar, setupRagTables } from './rag-store';
import { seedFromWikipedia } from './seed-data';

export interface RagRequest {
  messages: UIMessage[];
  chatId: string;
  userId: string;
  requestId?: string;
}

export interface RagResponse {
  traceId: string;
  stream: ReadableStream;
}

export interface AppKitRagContext {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: { extend(fn: (app: Application) => void): void };
}

type Usage = {
  costAvailable: boolean;
  costUsd?: number;
} & (
  | { usageAvailable: false }
  | {
      usageAvailable: true;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    }
);

interface WorkflowState {
  output: string;
  usage?: Usage;
  error?: string;
  persisted?: unknown;
}

const MAX_CAPTURE_BYTES = 64 * 1024;
const SECRET_KEY = /(?:authorization|api[-_\s]?key|cookie|credential|password|secret|token)/i;
const SECRET_TEXT =
  /(\b(?:authorization|api[-_\s]?key|cookie|credential|password|secret|token)\b["']?(?:\s*(?::|=)\s*|\s+(?:is\s+)?)(?:bearer\s+)?)([^\s,;)\]}]+)/gi;
const UC_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
const tracer = trace.getTracer('rag-chat', '1.0.0');
let ragContext: AppKitRagContext | undefined;

function redactText(value: string): string {
  return value.replace(SECRET_TEXT, '$1[REDACTED]');
}

function jsonable(value: unknown, seen = new WeakSet<object>()): unknown {
  try {
    if (typeof value === 'string') return redactText(value);
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
    if (Array.isArray(value)) return value.map((item) => jsonable(item, seen));
    if (typeof value === 'object') {
      if (seen.has(value)) return '<circular>';
      seen.add(value);
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : jsonable(record[key], seen)])
      );
    }
    return redactText(String(value));
  } catch (error) {
    return `<${typeof value}: ${error instanceof Error ? error.name : 'Error'}>`;
  }
}

export function safeTraceValue(value: unknown, maxBytes = MAX_CAPTURE_BYTES): unknown {
  const redacted = jsonable(value);
  const canonical = JSON.stringify(redacted);
  const encoded = Buffer.from(canonical, 'utf8');
  if (encoded.byteLength <= maxBytes) return redacted;
  let preview = encoded.subarray(0, maxBytes).toString('utf8');
  while (Buffer.byteLength(preview, 'utf8') > maxBytes) preview = preview.slice(0, -1);
  return {
    truncated: true,
    originalBytes: encoded.byteLength,
    sha256: createHash('sha256').update(encoded).digest('hex'),
    preview,
  };
}

function safeError(error: unknown): string {
  const message = redactText(error instanceof Error ? error.message : String(error));
  return Buffer.byteLength(message, 'utf8') <= 2048 ? message : JSON.stringify(safeTraceValue(message, 2048));
}

function set(span: Span, key: string, value: unknown): void {
  try {
    span.setAttribute(
      key,
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : JSON.stringify(value)
    );
  } catch {
    // An exporter failure must not alter an otherwise successful response.
  }
}

function setMany(span: Span, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) set(span, key, value);
}

function recordInputs(span: Span, value: unknown): void {
  set(span, 'mlflow.spanInputs', safeTraceValue(value));
}

function recordOutputs(span: Span, value: unknown): void {
  set(span, 'mlflow.spanOutputs', safeTraceValue(value));
}

function finish(
  span: Span,
  startedNs: bigint,
  outputs: unknown,
  attributes: Record<string, unknown> = {},
  error?: unknown
): void {
  recordOutputs(span, error ? { partial_output: outputs, error: safeError(error) } : outputs);
  setMany(span, { ...attributes, 'appkit.duration_ms': elapsedMs(startedNs) });
  try {
    if (error) {
      span.recordException(new Error(safeError(error)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: safeError(error) });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
  } catch {
    // Telemetry is best effort after the operation has completed.
  }
  try {
    span.end();
  } catch {
    // Telemetry is best effort after the operation has completed.
  }
}

function elapsedMs(startedNs: bigint): number {
  return Math.max(0, Number(process.hrtime.bigint() - startedNs) / 1_000_000);
}

function childSpan(root: Span, name: string, spanType: string, inputs: unknown): { span: Span; startedNs: bigint } {
  let span: Span;
  try {
    span = tracer.startSpan(
      name,
      { attributes: { 'mlflow.spanType': spanType } },
      trace.setSpan(context.active(), root)
    );
  } catch {
    span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
  }
  recordInputs(span, inputs);
  return { span, startedNs: process.hrtime.bigint() };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function tokenCount(value: unknown): number {
  return Math.max(0, Math.trunc(numberValue(value) ?? 0));
}

function normalizeUsage(raw: unknown, costSources: unknown[] = []): Usage {
  const usage = raw && typeof raw === 'object' ? (raw as Record<string, any>) : undefined;
  const usageAvailable = Boolean(
    usage &&
      [
        'inputTokens',
        'input_tokens',
        'prompt_tokens',
        'outputTokens',
        'output_tokens',
        'completion_tokens',
        'totalTokens',
        'total_tokens',
        'cacheReadInputTokens',
        'cache_read_input_tokens',
        'cacheCreationInputTokens',
        'cache_creation_input_tokens',
      ].some((key) => key in usage)
  );
  if (!usageAvailable || !usage) {
    const normalized: Usage = { usageAvailable: false, costAvailable: false };
    for (const source of [usage, ...costSources]) {
      if (addAvailableCost(normalized, source)) break;
    }
    return normalized;
  }
  const normalized: Extract<Usage, { usageAvailable: true }> = {
    usageAvailable: true,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costAvailable: false,
  };
  const v3Input = usage.inputTokens && typeof usage.inputTokens === 'object' ? usage.inputTokens : {};
  const v3Output = usage.outputTokens && typeof usage.outputTokens === 'object' ? usage.outputTokens : {};
  const inputDetails = usage.inputTokenDetails ?? usage.input_token_details ?? usage.prompt_tokens_details ?? v3Input;
  const inputTokens = tokenCount(v3Input.total ?? usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = tokenCount(
    v3Output.total ?? usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens
  );
  normalized.inputTokens = inputTokens;
  normalized.outputTokens = outputTokens;
  normalized.totalTokens = tokenCount(usage.totalTokens ?? usage.total_tokens ?? inputTokens + outputTokens);
  const cacheRead =
    usage.cacheReadInputTokens ??
    usage.cache_read_input_tokens ??
    inputDetails.cacheReadTokens ??
    inputDetails.cacheRead ??
    inputDetails.cached_tokens;
  const cacheCreation =
    usage.cacheCreationInputTokens ??
    usage.cache_creation_input_tokens ??
    inputDetails.cacheWriteTokens ??
    inputDetails.cacheWrite ??
    inputDetails.cache_creation_input_tokens;
  if (cacheRead !== undefined) normalized.cacheReadInputTokens = tokenCount(cacheRead);
  if (cacheCreation !== undefined) normalized.cacheCreationInputTokens = tokenCount(cacheCreation);
  for (const source of [usage, ...costSources]) {
    if (addAvailableCost(normalized, source)) break;
  }
  return normalized;
}

function addAvailableCost(usage: Usage, source: unknown): boolean {
  if (!source || typeof source !== 'object') return false;
  const record = source as Record<string, any>;
  const nestedUsage = record.usage && typeof record.usage === 'object' ? record.usage : {};
  const cost = numberValue(
    record.costUsd ?? record.cost_usd ?? record.total_cost_usd ?? record.cost ?? nestedUsage.cost_usd
  );
  if (cost === undefined) return false;
  usage.costAvailable = true;
  usage.costUsd = cost;
  return true;
}

function usageAttributes(usage: Usage): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    'appkit.usage': usage,
    'appkit.usage_available': usage.usageAvailable,
    'appkit.cost_available': usage.costAvailable,
  };
  if (usage.usageAvailable) {
    const tokenUsage: Record<string, number> = {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
    };
    if (usage.cacheReadInputTokens !== undefined) tokenUsage.cache_read_input_tokens = usage.cacheReadInputTokens;
    if (usage.cacheCreationInputTokens !== undefined)
      tokenUsage.cache_creation_input_tokens = usage.cacheCreationInputTokens;
    attributes['mlflow.chat.tokenUsage'] = tokenUsage;
  }
  if (usage.costAvailable) {
    attributes['appkit.cost_usd'] = usage.costUsd!;
    attributes['mlflow.llm.cost'] = { total_cost: usage.costUsd! };
  }
  return attributes;
}

async function getDatabricksToken(): Promise<string> {
  if (process.env.DATABRICKS_TOKEN) return process.env.DATABRICKS_TOKEN;
  const config = new Config({ profile: process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT' });
  await config.ensureResolved();
  const headers = new Headers();
  await config.authenticate(headers);
  const authHeader = headers.get('Authorization');
  if (!authHeader) throw new Error('Failed to obtain a Databricks access token');
  return authHeader.replace(/^Bearer\s+/i, '');
}

function gatewayBaseUrl(): string {
  const workspaceId = process.env.DATABRICKS_WORKSPACE_ID;
  if (!workspaceId) throw new Error('DATABRICKS_WORKSPACE_ID is required');
  const host = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const suffix = host?.split('.').slice(1).join('.') || 'cloud.databricks.com';
  return `https://${workspaceId}.ai-gateway.${suffix}/mlflow/v1`;
}

function coreMessages(messages: UIMessage[]): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  return messages.map((message) => ({
    role: message.role as 'user' | 'assistant' | 'system',
    content:
      message.parts
        ?.filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('') ?? '',
  }));
}

export function setRagContext(appkit: AppKitRagContext): void {
  ragContext = appkit;
}

export async function runRagWorkflow(request: RagRequest, rootSpan: Span): Promise<RagResponse> {
  if (!ragContext) throw new Error('RAG services have not been initialized');
  const workflowStartedNs = process.hrtime.bigint();
  const messages = coreMessages(request.messages);
  const userMessages = messages.filter((message) => message.role === 'user');
  const lastUserMessage = userMessages[userMessages.length - 1];
  if (!lastUserMessage) throw new Error('At least one user message is required');

  const memoryWrite = childSpan(rootSpan, 'rag.memory.user', 'MEMORY', {
    chatId: request.chatId,
    userId: request.userId,
    role: 'user',
    content: lastUserMessage.content,
  });
  try {
    const saved = await appendMessage(ragContext, {
      chatId: request.chatId,
      userId: request.userId,
      role: 'user',
      content: lastUserMessage.content,
    });
    finish(memoryWrite.span, memoryWrite.startedNs, saved);
  } catch (error) {
    finish(memoryWrite.span, memoryWrite.startedNs, { error: safeError(error) }, {}, error);
    throw error;
  }

  const embeddingSpan = childSpan(rootSpan, 'rag.embedding', 'EMBEDDING', { text: lastUserMessage.content });
  let embeddingResult;
  try {
    embeddingResult = await generateEmbeddingWithMetadata(lastUserMessage.content);
    const usage = normalizeUsage(embeddingResult.usage);
    finish(
      embeddingSpan.span,
      embeddingSpan.startedNs,
      { dimensions: embeddingResult.embedding.length },
      {
        'appkit.model': embeddingResult.model,
        'appkit.provider': 'databricks',
        ...usageAttributes(usage),
      }
    );
  } catch (error) {
    finish(embeddingSpan.span, embeddingSpan.startedNs, { error: safeError(error) }, {}, error);
    throw error;
  }

  const retrieverSpan = childSpan(rootSpan, 'rag.retrieve', 'RETRIEVER', {
    embeddingDimensions: embeddingResult.embedding.length,
    limit: 5,
  });
  let documents: Record<string, unknown>[];
  try {
    documents = await retrieveSimilar(ragContext, embeddingResult.embedding, 5);
    finish(
      retrieverSpan.span,
      retrieverSpan.startedNs,
      documents.map((document) => ({
        id: String(document.id),
        content: String(document.content),
        score: Number(document.similarity),
        metadata: (document.metadata as Record<string, unknown>) ?? {},
      }))
    );
  } catch (error) {
    finish(retrieverSpan.span, retrieverSpan.startedNs, { error: safeError(error) }, {}, error);
    throw error;
  }

  const sources = documents.map((document, index) => ({
    index: index + 1,
    content: String(document.content),
    similarity: Number(document.similarity),
    metadata: (document.metadata as Record<string, unknown>) ?? {},
  }));
  const contextPrefix = documents.length
    ? 'Use the following context to inform your answer. If not relevant, say so.\n\n' +
      documents.map((document, index) => `[${index + 1}] ${String(document.content)}`).join('\n\n')
    : '';
  const augmented = [...(contextPrefix ? [{ role: 'system' as const, content: contextPrefix }] : []), ...messages];
  const token = await getDatabricksToken();
  const endpoint = process.env.DATABRICKS_ENDPOINT || 'databricks-gpt-5-4-mini';
  const provider = createOpenAI({ baseURL: gatewayBaseUrl(), apiKey: token });
  const modelTrace = childSpan(rootSpan, 'rag.generate', 'CHAT_MODEL', {
    messages: augmented,
    maxOutputTokens: 1000,
  });
  const startedNs = modelTrace.startedNs;
  let firstTokenNs: bigint | undefined;
  let output = '';
  let finalized = false;
  const state: WorkflowState = { output: '' };

  const finalizeModel = async (event: any, error?: unknown) => {
    if (finalized) return;
    finalized = true;
    const finishedNs = process.hrtime.bigint();
    output = typeof event?.text === 'string' ? event.text : output;
    const errorRecord = error && typeof error === 'object' ? (error as Record<string, any>) : {};
    const response = event?.response ?? errorRecord.response;
    const responseRecord = response && typeof response === 'object' ? (response as Record<string, any>) : {};
    const usage = normalizeUsage(event?.usage ?? event?.totalUsage ?? errorRecord.usage ?? errorRecord.totalUsage, [
      responseRecord.body,
      responseRecord,
      errorRecord.response?.body,
      errorRecord.response,
    ]);
    state.output = output;
    state.usage = usage;
    if (error) state.error = safeError(error);
    finish(
      modelTrace.span,
      startedNs,
      { text: output, partial: Boolean(error) },
      {
        'appkit.model': String(responseRecord.modelId ?? endpoint),
        'appkit.provider': 'databricks',
        'appkit.finish_reason': event?.finishReason ?? errorRecord.finishReason,
        'appkit.ttft_ms': Math.max(0, Number((firstTokenNs ?? finishedNs) - startedNs) / 1_000_000),
        'appkit.stream_duration_ms': Math.max(0, Number(finishedNs - startedNs) / 1_000_000),
        ...usageAttributes(usage),
      },
      error
    );
    if (!error || output) {
      const persistence = childSpan(rootSpan, 'rag.memory.assistant', 'MEMORY', {
        chatId: request.chatId,
        userId: request.userId,
        role: 'assistant',
        content: output,
      });
      try {
        const saved = await appendMessage(ragContext!, {
          chatId: request.chatId,
          userId: request.userId,
          role: 'assistant',
          content: output,
        });
        state.persisted = saved;
        finish(persistence.span, persistence.startedNs, saved);
      } catch (persistenceError) {
        const persistenceMessage = safeError(persistenceError);
        state.error ??= persistenceMessage;
        finish(
          persistence.span,
          persistence.startedNs,
          { error: persistenceMessage, partialContent: output },
          {},
          persistenceError
        );
        if (!error) throw persistenceError;
      }
    }
  };

  const result = streamText({
    model: provider.chat(endpoint),
    messages: augmented,
    maxOutputTokens: 1000,
    onChunk: ({ chunk }: any) => {
      if (chunk?.type === 'text-delta') {
        firstTokenNs ??= process.hrtime.bigint();
        output += String(chunk.text ?? chunk.delta ?? '');
      }
    },
    onFinish: async (event: any) => finalizeModel(event),
    onError: async (event: any) => finalizeModel(event, event?.error),
  });
  const traceId = rootSpan.spanContext().traceId;
  const uiStream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'data-traceId', data: traceId, transient: false });
      if (sources.length) writer.write({ type: 'data-sources', data: sources, transient: false });
      writer.merge(result.toUIMessageStream());
    },
  });
  return {
    traceId,
    stream: wrapRootStream(uiStream, rootSpan, state, workflowStartedNs, finalizeModel),
  };
}

function wrapRootStream(
  stream: ReadableStream,
  rootSpan: Span,
  state: WorkflowState,
  startedNs: bigint,
  finalizeModel: (event: unknown, error?: unknown) => Promise<void>
): ReadableStream {
  const reader = stream.getReader();
  let ended = false;
  const endRoot = (error?: unknown) => {
    if (ended) return;
    ended = true;
    if (error) state.error = safeError(error);
    const rootPartialOutput = {
      text: state.output,
      persisted: state.persisted,
    };
    recordOutputs(
      rootSpan,
      state.error ? { partial_output: rootPartialOutput, error: state.error } : rootPartialOutput
    );
    if (state.usage) setMany(rootSpan, usageAttributes(state.usage));
    set(rootSpan, 'appkit.duration_ms', elapsedMs(startedNs));
    try {
      if (error || state.error) rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: state.error });
      else rootSpan.setStatus({ code: SpanStatusCode.OK });
      if (error) rootSpan.recordException(new Error(safeError(error)));
    } catch {
      // Export failures do not alter the response stream.
    }
    try {
      rootSpan.end();
    } catch {
      // Export failures do not alter the response stream.
    }
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        const item = await reader.read();
        if (item.done) {
          endRoot();
          controller.close();
        } else {
          controller.enqueue(item.value);
        }
      } catch (error) {
        await finalizeModel({}, error);
        endRoot(error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
        await finalizeModel({}, reason);
      } finally {
        endRoot(reason);
      }
    },
  });
}

export async function startRagRequest(request: RagRequest): Promise<RagResponse> {
  const requestId = request.requestId || randomUUID();
  let callbackStarted = false;
  try {
    return await tracer.startActiveSpan(
      'rag-chat.request',
      {
        attributes: {
          'mlflow.spanType': 'AGENT',
          'mlflow.trace.session': request.chatId,
          'mlflow.trace.user': request.userId,
          'appkit.request.id': requestId,
          'appkit.app.name': process.env.DATABRICKS_APP_NAME || 'rag-chat-app',
          'mlflow.spanInputs': JSON.stringify(
            safeTraceValue({
              messages: request.messages,
              chatId: request.chatId,
            })
          ),
        },
      },
      async (span) => {
        callbackStarted = true;
        try {
          return await runRagWorkflow({ ...request, requestId }, span);
        } catch (error) {
          recordOutputs(span, {
            partial_output: { available: false, reason: 'no output produced' },
            error: safeError(error),
          });
          try {
            span.recordException(error as Error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: safeError(error) });
            span.end();
          } catch {
            // Export failures do not replace the application error.
          }
          throw error;
        }
      }
    );
  } catch (error) {
    if (callbackStarted) throw error;
    return runRagWorkflow({ ...request, requestId }, trace.wrapSpanContext(INVALID_SPAN_CONTEXT));
  }
}

export function validateTracingEnvironment(environ: NodeJS.ProcessEnv = process.env): void {
  const required = [
    'MLFLOW_EXPERIMENT_ID',
    'MLFLOW_TRACING_SQL_WAREHOUSE_ID',
    'MLFLOW_UC_CATALOG',
    'MLFLOW_UC_SCHEMA',
    'MLFLOW_UC_TABLE_PREFIX',
    'MLFLOW_OTEL_SPANS_TABLE',
  ] as const;
  const missing = required.filter((name) => !environ[name]?.trim());
  if (missing.length) throw new Error(`Missing required tracing configuration: ${missing.join(', ')}`);
  if (!/^\d+$/.test(environ.MLFLOW_EXPERIMENT_ID!))
    throw new Error('Invalid tracing configuration: MLFLOW_EXPERIMENT_ID must be numeric');
  if (!/^[0-9a-f]{16}$/i.test(environ.MLFLOW_TRACING_SQL_WAREHOUSE_ID!))
    throw new Error('Invalid tracing configuration: MLFLOW_TRACING_SQL_WAREHOUSE_ID must be a 16-hex ID');
  for (const name of ['MLFLOW_UC_CATALOG', 'MLFLOW_UC_SCHEMA', 'MLFLOW_UC_TABLE_PREFIX'] as const) {
    if (!UC_IDENTIFIER.test(environ[name]!))
      throw new Error(`Invalid tracing configuration: ${name} must be a UC identifier`);
  }
  const expected = `${environ.MLFLOW_UC_CATALOG}.${environ.MLFLOW_UC_SCHEMA}.${environ.MLFLOW_UC_TABLE_PREFIX}_otel_spans`;
  if (environ.MLFLOW_OTEL_SPANS_TABLE !== expected)
    throw new Error(`Invalid tracing configuration: MLFLOW_OTEL_SPANS_TABLE must equal ${expected}`);
}

export async function initializeRagServices(appkit: AppKitRagContext): Promise<void> {
  setRagContext(appkit);
  await setupRagTables(appkit);
  await setupChatTables(appkit);
  const [{ setupChatRoutes }, { setupChatPersistenceRoutes }] = await Promise.all([
    import('../routes/chat-routes'),
    import('../routes/chat-persistence-routes'),
  ]);
  setupChatRoutes(appkit);
  setupChatPersistenceRoutes(appkit);
  const seedTimeoutMs = 30_000;
  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[rag] seed still running after ${seedTimeoutMs}ms; startup will continue`);
      resolve();
    }, seedTimeoutMs);
    timer.unref?.();
  });
  void Promise.race([
    seedFromWikipedia(appkit, generateEmbedding, insertDocument).catch((error) => {
      console.warn('[rag] seed failed:', safeError(error));
    }),
    timeout,
  ]);
}
