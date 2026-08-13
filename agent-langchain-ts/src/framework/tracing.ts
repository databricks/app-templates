import * as mlflow from "@mlflow/core";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { createHash } from "crypto";

const MAX_CAPTURE_BYTES = 64 * 1024;
const SECRET_KEY =
  /(?:authorization|api[-_]?key|cookie|credential|password|secret|token)/i;
const SECRET_TEXT =
  /(\b(?:authorization|api[-_]?key|cookie|credential|password|secret|token)\b["']?\s*(?::|=|\s)\s*)(?:(["'])(?:bearer\s+)?((?:\\.|(?!\2)[^\\])*)\2|(?:bearer\s+)?([^\s,;)\]}]+))/gi;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required tracing environment variable: ${name}`);
  }
  return value;
}

function requireExperimentId(): string {
  const value = requireEnv("MLFLOW_EXPERIMENT_ID");
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(
      "Invalid tracing environment variable MLFLOW_EXPERIMENT_ID: expected a numeric experiment ID",
    );
  }
  return value;
}

function requireUcIdentifier(name: string): string {
  const value = requireEnv(name);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,254}$/.test(value)) {
    throw new Error(
      `Invalid tracing environment variable ${name}: expected a Unity Catalog identifier`,
    );
  }
  return value;
}

function resolveTrackingUri(): string {
  const value = process.env.MLFLOW_TRACKING_URI?.trim() || "databricks";
  if (value === "databricks" || /^databricks:\/\/[^/\s]+$/.test(value))
    return value;
  try {
    const url = new URL(value);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname
    ) {
      return value;
    }
  } catch {
    // Fall through to the startup error below.
  }
  throw new Error(
    "Invalid tracing environment variable MLFLOW_TRACKING_URI: expected databricks, databricks://<profile>, or an HTTP(S) URL",
  );
}

export function buildTracingConfig() {
  return {
    trackingUri: resolveTrackingUri(),
    experimentId: requireExperimentId(),
    traceLocation: {
      catalogName: requireUcIdentifier("MLFLOW_UC_CATALOG"),
      schemaName: requireUcIdentifier("MLFLOW_UC_SCHEMA"),
      tablePrefix: requireUcIdentifier("MLFLOW_UC_TABLE_PREFIX"),
    },
  };
}

export function initializeTracing(): void {
  mlflow.init(buildTracingConfig());
}

export function setTraceIdentity(
  sessionId: string,
  userId: string,
  requestId: string,
): void {
  mlflow.updateCurrentTrace({
    metadata: {
      "mlflow.trace.session": safeIdentity(sessionId),
      "mlflow.trace.user": safeIdentity(userId),
      "appkit.app.name": safeIdentity(
        process.env.DATABRICKS_APP_NAME ?? "agent-langchain-ts",
      ),
      "appkit.request.id": safeIdentity(requestId),
    },
  });
}

export interface TraceIdentity {
  sessionId: string;
  userId: string;
  requestId: string;
}

export interface AgentRequestTrace {
  traceId: string;
  setOutputs(outputs: unknown): void;
  recordError(error: unknown): string;
}

interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costAvailable: boolean;
  costUsd?: number;
}

class RequestTraceState {
  private modelSteps = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalTokens = 0;
  private cacheReadInputTokens = 0;
  private cacheCreationInputTokens = 0;
  private hasCacheRead = false;
  private hasCacheCreation = false;
  private costAvailable = true;
  private costUsd = 0;

  constructor(readonly span: mlflow.LiveSpan) {}

  addModelUsage(usage: NormalizedUsage): void {
    this.modelSteps += 1;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.totalTokens += usage.totalTokens;
    if (usage.cacheReadInputTokens !== undefined) {
      this.hasCacheRead = true;
      this.cacheReadInputTokens += usage.cacheReadInputTokens;
    }
    if (usage.cacheCreationInputTokens !== undefined) {
      this.hasCacheCreation = true;
      this.cacheCreationInputTokens += usage.cacheCreationInputTokens;
    }
    if (!usage.costAvailable || usage.costUsd === undefined) {
      this.costAvailable = false;
    } else {
      this.costUsd += usage.costUsd;
    }
  }

  finalize(): void {
    const usage: NormalizedUsage = {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      costAvailable: this.modelSteps > 0 && this.costAvailable,
    };
    const tokenUsage: Record<string, number> = {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      total_tokens: this.totalTokens,
    };
    if (this.hasCacheRead) {
      usage.cacheReadInputTokens = this.cacheReadInputTokens;
      tokenUsage.cache_read_input_tokens = this.cacheReadInputTokens;
    }
    if (this.hasCacheCreation) {
      usage.cacheCreationInputTokens = this.cacheCreationInputTokens;
      tokenUsage.cache_creation_input_tokens = this.cacheCreationInputTokens;
    }
    if (usage.costAvailable) usage.costUsd = Number(this.costUsd.toFixed(12));
    this.span.setAttribute("appkit.usage", usage);
    this.span.setAttribute("mlflow.chat.tokenUsage", tokenUsage);
  }
}

const requestTraces = new Map<string, RequestTraceState>();

interface RunState {
  span: mlflow.LiveSpan;
  startedNs: bigint;
  firstTokenNs?: bigint;
  model?: string;
  provider?: string;
}

export class LangChainTracingCallback extends BaseCallbackHandler {
  name = "mlflow-core-langchain";
  private readonly root: mlflow.LiveSpan | null;
  private readonly requestTrace?: RequestTraceState;
  private readonly runs = new Map<string, RunState>();

  constructor() {
    super();
    this.root = mlflow.getCurrentActiveSpan();
    this.requestTrace = this.root
      ? requestTraces.get(this.root.traceId)
      : undefined;
  }

  handleChainStart(
    chain: any,
    inputs: any,
    runId: string,
    // @langchain/core 1.1.x dispatches parentRunId here despite its stale .d.ts.
    parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    _runType?: string,
    runName?: string,
  ): void {
    this.startRun({
      runId,
      parentRunId,
      name: runName || serializedName(chain) || "langchain.chain",
      spanType: mlflow.SpanType.CHAIN,
      inputs,
    });
  }

  handleChainEnd(outputs: any, runId: string): void {
    this.endRun(runId, outputs);
  }

  handleChainError(error: any, runId: string): void {
    this.errorRun(runId, error);
  }

  handleToolStart(
    tool: any,
    input: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    this.startRun({
      runId,
      parentRunId,
      name: runName || serializedName(tool) || "langchain.tool",
      spanType: mlflow.SpanType.TOOL,
      inputs: parseToolInput(input),
    });
  }

  handleToolEnd(output: any, runId: string): void {
    this.endRun(runId, output);
  }

  handleToolError(error: any, runId: string): void {
    this.errorRun(runId, error);
  }

  handleRetrieverStart(
    retriever: any,
    query: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    name?: string,
  ): void {
    this.startRun({
      runId,
      parentRunId,
      name: name || serializedName(retriever) || "langchain.retriever",
      spanType: mlflow.SpanType.RETRIEVER,
      inputs: { query },
    });
  }

  handleRetrieverEnd(documents: any, runId: string): void {
    this.endRun(runId, documents);
  }

  handleRetrieverError(error: any, runId: string): void {
    this.errorRun(runId, error);
  }

  handleAgentAction(action: any, runId: string): void {
    this.recordDecision("langchain.agent.action", action, runId);
  }

  handleAgentEnd(finish: any, runId: string): void {
    this.recordDecision("langchain.agent.end", finish, runId);
  }

  handleChatModelStart(
    llm: any,
    messages: any,
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, any>,
    _tags?: string[],
    metadata?: Record<string, any>,
    runName?: string,
  ): void {
    const params = extraParams?.invocation_params ?? extraParams ?? {};
    const model =
      params.model ?? params.model_name ?? runName ?? serializedName(llm);
    const provider =
      metadata?.ls_provider ??
      params.provider ??
      providerFromType(params._type);
    this.startRun({
      runId,
      parentRunId,
      name: runName || model || "langchain.chat_model",
      spanType: mlflow.SpanType.CHAT_MODEL,
      inputs: messages,
      model,
      provider,
    });
  }

  handleLLMStart(
    llm: any,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, any>,
    _tags?: string[],
    metadata?: Record<string, any>,
    runName?: string,
  ): void {
    if (this.runs.has(runId)) return;
    const params = extraParams?.invocation_params ?? extraParams ?? {};
    const model =
      params.model ?? params.model_name ?? runName ?? serializedName(llm);
    this.startRun({
      runId,
      parentRunId,
      name: runName || model || "langchain.llm",
      spanType: mlflow.SpanType.LLM,
      inputs: prompts,
      model,
      provider:
        metadata?.ls_provider ??
        params.provider ??
        providerFromType(params._type),
    });
  }

  handleLLMNewToken(_token: string, _indices: unknown, runId: string): void {
    const run = this.runs.get(runId);
    if (run && run.firstTokenNs === undefined)
      run.firstTokenNs = process.hrtime.bigint();
  }

  handleLLMEnd(output: any, runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const endedNs = process.hrtime.bigint();
    const message = firstGenerationMessage(output);
    const usageMetadata = asRecord(message?.usage_metadata);
    const responseMetadata = asRecord(message?.response_metadata);
    const llmOutput = asRecord(output?.llmOutput ?? output?.llm_output);
    const legacyUsage = asRecord(
      llmOutput.tokenUsage ?? llmOutput.token_usage ?? llmOutput.usage,
    );
    const inputTokens = firstPresent(
      [usageMetadata, legacyUsage],
      ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens"],
    );
    const outputTokens = firstPresent(
      [usageMetadata, legacyUsage],
      [
        "output_tokens",
        "completion_tokens",
        "outputTokens",
        "completionTokens",
      ],
    );
    const inputDetails = asRecord(usageMetadata.input_token_details);
    const usage: NormalizedUsage = {
      inputTokens: nonnegativeInt(inputTokens),
      outputTokens: nonnegativeInt(outputTokens),
      totalTokens: nonnegativeInt(
        firstPresent(
          [usageMetadata, legacyUsage],
          ["total_tokens", "totalTokens"],
        ) ?? nonnegativeInt(inputTokens) + nonnegativeInt(outputTokens),
      ),
      costAvailable: false,
    };
    const cacheRead = firstPresent(
      [inputDetails, usageMetadata, legacyUsage],
      [
        "cache_read",
        "cache_read_input_tokens",
        "cached_tokens",
        "cacheReadInputTokens",
      ],
    );
    const cacheCreation = firstPresent(
      [inputDetails, usageMetadata, legacyUsage],
      [
        "cache_creation",
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
      ],
    );
    if (cacheRead !== undefined)
      usage.cacheReadInputTokens = nonnegativeInt(cacheRead);
    if (cacheCreation !== undefined) {
      usage.cacheCreationInputTokens = nonnegativeInt(cacheCreation);
    }
    const cost = providerCost(responseMetadata, llmOutput, usageMetadata);
    if (cost !== undefined) {
      usage.costAvailable = true;
      usage.costUsd = cost;
    }
    this.requestTrace?.addModelUsage(usage);

    const firstTokenNs = run.firstTokenNs ?? endedNs;
    const model =
      run.model ?? responseMetadata.model_name ?? llmOutput.model_name;
    run.span.setAttributes({
      "appkit.model": safeTraceValue(model),
      "appkit.provider": safeTraceValue(run.provider),
      "appkit.usage": usage,
      "appkit.ttft_ms": nsToMs(firstTokenNs - run.startedNs),
      "appkit.stream_duration_ms": nsToMs(endedNs - run.startedNs),
      "appkit.finish_reason": safeTraceValue(
        responseMetadata.finish_reason ??
          firstGenerationInfo(output).finish_reason,
      ),
      "appkit.cost_available": usage.costAvailable,
      "mlflow.chat.tokenUsage": toMlflowTokenUsage(usage),
    });
    if (usage.costAvailable) {
      run.span.setAttribute("appkit.cost_usd", usage.costUsd);
      run.span.setAttribute("mlflow.llm.cost", usage.costUsd);
    }
    this.endRun(runId, output);
  }

  handleLLMError(error: any, runId: string): void {
    const usage: NormalizedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costAvailable: false,
    };
    this.requestTrace?.addModelUsage(usage);
    const run = this.runs.get(runId);
    if (run) {
      const endedNs = process.hrtime.bigint();
      run.span.setAttributes({
        "appkit.usage": usage,
        "appkit.ttft_ms": nsToMs((run.firstTokenNs ?? endedNs) - run.startedNs),
        "appkit.stream_duration_ms": nsToMs(endedNs - run.startedNs),
        "appkit.cost_available": false,
      });
    }
    this.errorRun(runId, error);
  }

  private startRun(options: {
    runId: string;
    parentRunId?: string;
    name: string;
    spanType: mlflow.SpanType;
    inputs: unknown;
    model?: string;
    provider?: string;
  }): void {
    const parent =
      (options.parentRunId
        ? this.runs.get(options.parentRunId)?.span
        : undefined) ??
      this.root ??
      undefined;
    const span = mlflow.startSpan({
      name: options.name,
      spanType: options.spanType,
      parent,
      inputs: safeTraceValue(options.inputs),
      attributes: {
        "langchain.run_id": safeTraceValue(options.runId),
        "langchain.parent_run_id": safeTraceValue(options.parentRunId),
      },
    });
    this.runs.set(options.runId, {
      span,
      startedNs: process.hrtime.bigint(),
      model: options.model,
      provider: options.provider,
    });
  }

  private recordDecision(name: string, value: unknown, runId: string): void {
    const parent = this.runs.get(runId)?.span;
    if (!parent) return;
    const captured = safeTraceValue(value);
    const span = mlflow.startSpan({
      name,
      spanType: mlflow.SpanType.CHAIN,
      parent,
      inputs: captured,
      attributes: { "langchain.run_id": safeTraceValue(runId) },
    });
    span.end({
      outputs: captured,
      status: mlflow.SpanStatusCode.OK,
    });
  }

  private endRun(runId: string, outputs: unknown): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    run.span.end({
      outputs: safeTraceValue(outputs),
      status: mlflow.SpanStatusCode.OK,
    });
  }

  private errorRun(runId: string, error: unknown): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    const normalized = safeError(error);
    run.span.recordException(new Error(normalized));
    run.span.end({
      outputs: { error: normalized },
      status: mlflow.SpanStatusCode.ERROR,
    });
  }
}

export function createLangChainTracingCallback(): LangChainTracingCallback {
  return new LangChainTracingCallback();
}

export async function withAgentRequestTrace<T>(
  inputs: unknown,
  identity: TraceIdentity,
  operation: (trace: AgentRequestTrace) => Promise<T>,
): Promise<{ value: T; traceId: string }> {
  return (await mlflow.withSpan(
    async (span) => {
      span.setInputs(safeTraceValue(inputs));
      setTraceIdentity(identity.sessionId, identity.userId, identity.requestId);
      const requestTrace = new RequestTraceState(span);
      requestTraces.set(span.traceId, requestTrace);
      let recordedError = false;

      const trace: AgentRequestTrace = {
        traceId: span.traceId,
        setOutputs: (outputs) => span.setOutputs(safeTraceValue(outputs)),
        recordError: (error) => {
          recordedError = true;
          const message = safeError(error);
          span.setOutputs({ error: message });
          span.setStatus(mlflow.SpanStatusCode.ERROR, message);
          span.recordException(new Error(message));
          return message;
        },
      };
      try {
        const value = await operation(trace);
        if (!recordedError) span.setStatus(mlflow.SpanStatusCode.OK);
        return { value, traceId: span.traceId };
      } catch (error) {
        const message = safeError(error);
        span.setOutputs({ error: message });
        span.setStatus(mlflow.SpanStatusCode.ERROR, message);
        throw new Error(message);
      } finally {
        requestTrace.finalize();
        requestTraces.delete(span.traceId);
      }
    },
    {
      name: "langchain.request",
      spanType: mlflow.SpanType.AGENT,
    },
  )) as { value: T; traceId: string };
}

export async function flushTracing(): Promise<void> {
  try {
    await mlflow.flushTraces();
  } catch (error) {
    console.error("MLflow trace export failed during flush:", safeError(error));
  }
}

function serializedName(value: any): string | undefined {
  const id = Array.isArray(value?.id) ? value.id : [];
  const name = id[id.length - 1];
  return typeof name === "string" ? name : undefined;
}

function providerFromType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/^chat-/, "").replace(/-chat$/, "");
}

function parseToolInput(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function redactSecretText(value: string): string {
  return value.replace(
    SECRET_TEXT,
    (_match, prefix: string, quote?: string) =>
      `${prefix}${quote ?? ""}[REDACTED]${quote ?? ""}`,
  );
}

function toJsonable(value: unknown, seen: WeakSet<object>): unknown {
  try {
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      return value;
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          return toJsonable(JSON.parse(value), seen);
        } catch {
          // Preserve malformed JSON as redacted text.
        }
      }
      return redactSecretText(value);
    }
    if (typeof value === "undefined") return null;
    if (typeof value === "function" || typeof value === "symbol")
      return String(value);
    if (value instanceof Error) {
      return { name: value.name, message: redactSecretText(value.message) };
    }
    if (Buffer.isBuffer(value)) return redactSecretText(value.toString("utf8"));
    if (Array.isArray(value))
      return value.map((item) => toJsonable(item, seen));
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) {
      return toJsonable(Object.fromEntries(value), seen);
    }
    if (value instanceof Set)
      return [...value].map((item) => toJsonable(item, seen));
    if (typeof value === "object") {
      if (seen.has(value)) return "<Circular>";
      seen.add(value);
      const objectValue = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(objectValue).sort()) {
        result[key] = SECRET_KEY.test(key)
          ? "[REDACTED]"
          : toJsonable(objectValue[key], seen);
      }
      seen.delete(value);
      return result;
    }
    return redactSecretText(String(value));
  } catch (error) {
    return `<${typeof value}: ${error instanceof Error ? error.name : "Error"}>`;
  }
}

export function safeTraceValue(
  value: unknown,
  maxBytes = MAX_CAPTURE_BYTES,
): unknown {
  const redacted = toJsonable(value, new WeakSet());
  const encoded = Buffer.from(JSON.stringify(redacted), "utf8");
  if (encoded.byteLength <= maxBytes) return redacted;

  let previewBytes = encoded.subarray(0, maxBytes);
  let preview = previewBytes.toString("utf8");
  while (preview.endsWith("�") && previewBytes.length > 0) {
    previewBytes = previewBytes.subarray(0, previewBytes.length - 1);
    preview = previewBytes.toString("utf8");
  }
  return {
    truncated: true,
    originalBytes: encoded.byteLength,
    sha256: createHash("sha256").update(encoded).digest("hex"),
    preview,
  };
}

export class BoundedTraceAccumulator {
  private readonly digest = createHash("sha256");
  private readonly previewChunks: Buffer[] = [];
  private previewBytes = 0;
  private originalBytes = 1;
  private itemCount = 0;
  private items: unknown[] | null = [];
  private finalized?: unknown[] | Record<string, unknown>;

  constructor(private readonly maxBytes = MAX_CAPTURE_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new Error("maxBytes must be a positive integer");
    }
    const opening = Buffer.from("[");
    this.digest.update(opening);
    this.previewChunks.push(opening);
    this.previewBytes = opening.byteLength;
  }

  add(value: unknown): void {
    if (this.finalized !== undefined) {
      throw new Error("cannot add values after capture is finalized");
    }
    const redacted = safeTraceValue(value);
    const encoded = Buffer.from(JSON.stringify(redacted), "utf8");
    const prefix = this.itemCount === 0 ? Buffer.alloc(0) : Buffer.from(",");
    const chunk = Buffer.concat([prefix, encoded]);
    this.digest.update(chunk);
    this.originalBytes += chunk.byteLength;

    const remaining = this.maxBytes - this.previewBytes;
    if (remaining > 0) {
      const retained = chunk.subarray(0, remaining);
      this.previewChunks.push(retained);
      this.previewBytes += retained.byteLength;
    }
    if (this.items !== null) {
      if (this.originalBytes + 1 <= this.maxBytes) this.items.push(redacted);
      else this.items = null;
    }
    this.itemCount += 1;
  }

  snapshot(): unknown[] | Record<string, unknown> {
    if (this.finalized !== undefined) return this.finalized;
    const closing = Buffer.from("]");
    this.digest.update(closing);
    this.originalBytes += closing.byteLength;
    if (this.previewBytes < this.maxBytes) {
      this.previewChunks.push(closing);
      this.previewBytes += closing.byteLength;
    }
    if (this.items !== null && this.originalBytes <= this.maxBytes) {
      this.finalized = this.items;
      return this.finalized;
    }
    let previewBuffer = Buffer.concat(this.previewChunks);
    let preview = previewBuffer.toString("utf8");
    while (preview.endsWith("�") && previewBuffer.length > 0) {
      previewBuffer = previewBuffer.subarray(0, previewBuffer.length - 1);
      preview = previewBuffer.toString("utf8");
    }
    this.finalized = {
      truncated: true,
      originalBytes: this.originalBytes,
      sha256: this.digest.digest("hex"),
      preview,
    };
    return this.finalized;
  }
}

function safeIdentity(value: string): string {
  const safe = safeTraceValue(value, 2048);
  return typeof safe === "string" ? safe : JSON.stringify(safe);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const safe = safeTraceValue(message, 2048);
  return typeof safe === "string" ? safe : JSON.stringify(safe);
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : {};
}

function firstGenerationMessage(output: any): any {
  const generation = output?.generations?.[0]?.[0];
  return generation?.message ?? generation;
}

function firstGenerationInfo(output: any): Record<string, any> {
  const generation = output?.generations?.[0]?.[0];
  return asRecord(generation?.generationInfo ?? generation?.generation_info);
}

function firstPresent(
  mappings: Record<string, any>[],
  keys: string[],
): unknown {
  for (const mapping of mappings) {
    for (const key of keys) {
      if (mapping[key] !== undefined && mapping[key] !== null)
        return mapping[key];
    }
  }
  return undefined;
}

function nonnegativeInt(value: unknown): number {
  if (typeof value === "boolean") return 0;
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function providerCost(...mappings: Record<string, any>[]): number | undefined {
  for (const mapping of mappings) {
    for (const key of ["cost", "cost_usd", "total_cost_usd"]) {
      const value = mapping[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        return value;
    }
  }
  return undefined;
}

function toMlflowTokenUsage(usage: NormalizedUsage): Record<string, number> {
  const result: Record<string, number> = {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  };
  if (usage.cacheReadInputTokens !== undefined) {
    result.cache_read_input_tokens = usage.cacheReadInputTokens;
  }
  if (usage.cacheCreationInputTokens !== undefined) {
    result.cache_creation_input_tokens = usage.cacheCreationInputTokens;
  }
  return result;
}

function nsToMs(value: bigint): number {
  return Math.max(0, Number(value) / 1_000_000);
}
