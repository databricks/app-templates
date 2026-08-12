import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@mlflow/core", () => ({
  ...(() => {
    const spans: FakeSpan[] = [];
    let activeSpan: FakeSpan | null = null;
    let nextSpanId = 1;

    class FakeSpan {
      readonly traceId: string;
      readonly spanId: string;
      readonly parentId: string | null;
      readonly name: string;
      readonly spanType: string;
      inputs: unknown;
      outputs: unknown;
      attributes: Record<string, unknown>;
      status: { code: string; description?: string } = { code: "UNSET" };
      events: Array<{ name: string; attributes?: Record<string, unknown> }> =
        [];
      ended = false;

      constructor(options: Record<string, any>) {
        const parent = options.parent ?? activeSpan;
        this.traceId =
          parent?.traceId ??
          "trace:/catalog_test.schema_test.langchain_test/0123456789abcdef0123456789abcdef";
        this.spanId = `span-${nextSpanId++}`;
        this.parentId = parent?.spanId ?? null;
        this.name = options.name;
        this.spanType = options.spanType ?? "UNKNOWN";
        this.inputs = options.inputs;
        this.attributes = { ...(options.attributes ?? {}) };
        spans.push(this);
      }

      setInputs(value: unknown): void {
        this.inputs = value;
      }
      setOutputs(value: unknown): void {
        this.outputs = value;
      }
      setAttribute(key: string, value: unknown): void {
        this.attributes[key] = value;
      }
      setAttributes(values: Record<string, unknown>): void {
        Object.assign(this.attributes, values);
      }
      setStatus(code: string, description?: string): void {
        this.status = { code, ...(description ? { description } : {}) };
      }
      recordException(error: Error): void {
        this.events.push({
          name: "exception",
          attributes: { message: error.message },
        });
      }
      addEvent(event: {
        name: string;
        attributes?: Record<string, unknown>;
      }): void {
        this.events.push(event);
      }
      end(options?: Record<string, any>): void {
        if (options?.outputs !== undefined) this.outputs = options.outputs;
        if (options?.attributes) this.setAttributes(options.attributes);
        if (options?.status) this.setStatus(options.status);
        this.ended = true;
      }
    }

    const init = jest.fn();
    const updateCurrentTrace = jest.fn((options: Record<string, any>) => {
      if (activeSpan) {
        activeSpan.attributes.traceMetadata = options.metadata;
      }
    });

    return {
      SpanType: {
        AGENT: "AGENT",
        CHAIN: "CHAIN",
        CHAT_MODEL: "CHAT_MODEL",
        LLM: "LLM",
        TOOL: "TOOL",
        RETRIEVER: "RETRIEVER",
      },
      SpanStatusCode: { OK: "OK", ERROR: "ERROR" },
      init,
      updateCurrentTrace,
      getCurrentActiveSpan: () => activeSpan,
      startSpan: (options: Record<string, any>) => new FakeSpan(options),
      withSpan: async (
        callback: (span: FakeSpan) => unknown,
        options: Record<string, any>,
      ) => {
        const span = new FakeSpan(options);
        const previous = activeSpan;
        activeSpan = span;
        try {
          const value = await callback(span);
          if (span.outputs === undefined) span.setOutputs(value);
          span.end();
          return value;
        } catch (error) {
          span.setStatus(
            "ERROR",
            error instanceof Error ? error.message : String(error),
          );
          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
          span.end();
          throw error;
        } finally {
          activeSpan = previous;
        }
      },
      flushTraces: jest.fn(async () => undefined),
      __spans: spans,
      __reset: () => {
        spans.length = 0;
        activeSpan = null;
        nextSpanId = 1;
      },
    };
  })(),
}));

interface FakeSpan {
  traceId: string;
  spanId: string;
  parentId: string | null;
  name: string;
  spanType: string;
  inputs: unknown;
  outputs: unknown;
  attributes: Record<string, any>;
  status: { code: string; description?: string };
  events: Array<{ name: string; attributes?: Record<string, unknown> }>;
  ended: boolean;
}

import * as mlflow from "@mlflow/core";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import {
  BoundedTraceAccumulator,
  flushTracing,
  initializeTracing,
  setTraceIdentity,
  withAgentRequestTrace,
} from "../../src/framework/tracing.js";
import { StandardAgent } from "../../src/agent.js";

const mlflowTest = mlflow as typeof mlflow & {
  __spans: FakeSpan[];
  __reset(): void;
};

const REQUIRED_ENV = [
  "MLFLOW_EXPERIMENT_ID",
  "MLFLOW_UC_CATALOG",
  "MLFLOW_UC_SCHEMA",
  "MLFLOW_UC_TABLE_PREFIX",
] as const;

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.mocked(mlflow.init).mockClear();
  jest.mocked(mlflow.updateCurrentTrace).mockClear();
  mlflowTest.__reset();
});

describe("MLflow tracing", () => {
  test.each(REQUIRED_ENV)("fails startup when %s is missing", (missingName) => {
    process.env.MLFLOW_EXPERIMENT_ID = "123456789";
    process.env.MLFLOW_UC_CATALOG = "catalog_test";
    process.env.MLFLOW_UC_SCHEMA = "schema_test";
    process.env.MLFLOW_UC_TABLE_PREFIX = "langchain_test";
    delete process.env[missingName];

    expect(() => initializeTracing()).toThrow(
      `Missing required tracing environment variable: ${missingName}`,
    );
  });

  test("fails startup when the experiment ID is invalid", () => {
    process.env.MLFLOW_EXPERIMENT_ID = "not-an-experiment";
    process.env.MLFLOW_UC_CATALOG = "catalog_test";
    process.env.MLFLOW_UC_SCHEMA = "schema_test";
    process.env.MLFLOW_UC_TABLE_PREFIX = "langchain_test";

    expect(() => initializeTracing()).toThrow(
      "Invalid tracing environment variable MLFLOW_EXPERIMENT_ID",
    );
  });

  test("fails startup when a Unity Catalog identifier is invalid", () => {
    process.env.MLFLOW_EXPERIMENT_ID = "123456789";
    process.env.MLFLOW_UC_CATALOG = "bad.catalog";
    process.env.MLFLOW_UC_SCHEMA = "schema_test";
    process.env.MLFLOW_UC_TABLE_PREFIX = "langchain_test";

    expect(() => initializeTracing()).toThrow(
      "Invalid tracing environment variable MLFLOW_UC_CATALOG",
    );
  });

  test("fails startup when the tracking URI is invalid", () => {
    process.env.MLFLOW_TRACKING_URI = "ftp://unsupported";
    process.env.MLFLOW_EXPERIMENT_ID = "123456789";
    process.env.MLFLOW_UC_CATALOG = "catalog_test";
    process.env.MLFLOW_UC_SCHEMA = "schema_test";
    process.env.MLFLOW_UC_TABLE_PREFIX = "langchain_test";

    expect(() => initializeTracing()).toThrow(
      "Invalid tracing environment variable MLFLOW_TRACKING_URI",
    );
  });

  test("initializes MLflow core with the exact UC trace location", () => {
    process.env.MLFLOW_TRACKING_URI = "   ";
    process.env.MLFLOW_EXPERIMENT_ID = "123456789";
    process.env.MLFLOW_UC_CATALOG = "catalog_test";
    process.env.MLFLOW_UC_SCHEMA = "schema_test";
    process.env.MLFLOW_UC_TABLE_PREFIX = "langchain_test";

    initializeTracing();

    expect(mlflow.init).toHaveBeenCalledWith({
      trackingUri: "databricks",
      experimentId: "123456789",
      traceLocation: {
        catalogName: "catalog_test",
        schemaName: "schema_test",
        tablePrefix: "langchain_test",
      },
    });
  });

  test("sets app, session, user, and request identity on the active trace", () => {
    process.env.DATABRICKS_APP_NAME = "deployed-langchain-agent";

    setTraceIdentity("session-123", "user-456", "request-789");

    expect(mlflow.updateCurrentTrace).toHaveBeenCalledWith({
      metadata: {
        "mlflow.trace.session": "session-123",
        "mlflow.trace.user": "user-456",
        "appkit.app.name": "deployed-langchain-agent",
        "appkit.request.id": "request-789",
      },
    });
  });

  test("traces and aggregates every model iteration in an invocation", async () => {
    const runnable = {
      async invoke(_input: unknown, options?: Record<string, any>) {
        const callback = options?.callbacks?.[0];
        if (!callback)
          throw new Error("production invocation did not install tracing");

        await callback.handleChainStart(
          { id: ["langgraph", "agent"] },
          { question: "weather in Paris" },
          "agent-run",
          undefined,
          [],
          {},
          "LangGraph",
        );
        await callback.handleChatModelStart(
          { id: ["databricks", "chat"] },
          [[{ role: "user", content: "weather in Paris" }]],
          "model-run-1",
          "agent-run",
          { model: "model-one" },
          [],
          { ls_provider: "databricks" },
          "model-one",
        );
        await callback.handleLLMNewToken(
          "checking",
          { prompt: 0, completion: 0 },
          "model-run-1",
        );
        await callback.handleLLMEnd(
          {
            generations: [
              [
                {
                  message: {
                    content: "checking",
                    usage_metadata: {
                      input_tokens: 10,
                      output_tokens: 4,
                      total_tokens: 14,
                      input_token_details: {
                        cache_read: 3,
                        cache_creation: 1,
                      },
                    },
                    response_metadata: {
                      model_name: "model-one",
                      finish_reason: "tool_calls",
                    },
                  },
                  generationInfo: { finish_reason: "tool_calls" },
                },
              ],
            ],
            llmOutput: {},
          },
          "model-run-1",
        );
        await callback.handleChatModelStart(
          { id: ["databricks", "chat"] },
          [[{ role: "user", content: "weather in Paris" }]],
          "model-run-2",
          "agent-run",
          { model: "model-two" },
          [],
          { ls_provider: "databricks" },
          "model-two",
        );
        await callback.handleLLMNewToken(
          "sunny",
          { prompt: 0, completion: 0 },
          "model-run-2",
        );
        await callback.handleLLMEnd(
          {
            generations: [
              [
                {
                  message: {
                    content: "sunny",
                    usage_metadata: {
                      input_tokens: 5,
                      output_tokens: 2,
                      total_tokens: 7,
                      input_token_details: { cache_read: 1 },
                    },
                    response_metadata: {
                      model_name: "model-two",
                      finish_reason: "stop",
                    },
                  },
                  generationInfo: { finish_reason: "stop" },
                },
              ],
            ],
            llmOutput: { total_cost_usd: 0.01 },
          },
          "model-run-2",
        );
        await callback.handleChainEnd({ answer: "sunny" }, "agent-run");
        return { messages: [{ role: "assistant", content: "sunny" }] };
      },
    };
    const agent = new StandardAgent(runnable as any, "helpful");

    await withAgentRequestTrace(
      { input: "weather in Paris" },
      { sessionId: "session-1", userId: "user-1", requestId: "request-1" },
      async (trace) => {
        const output = await agent.invoke({ input: "weather in Paris" });
        trace.setOutputs(output);
        return output;
      },
    );

    const roots = mlflowTest.__spans.filter(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    const models = mlflowTest.__spans.filter(
      (span) => span.spanType === "CHAT_MODEL",
    );
    expect(roots).toHaveLength(1);
    expect(roots[0].status.code).toBe("OK");
    expect(models.map((span) => span.attributes["langchain.run_id"])).toEqual([
      "model-run-1",
      "model-run-2",
    ]);
    expect(models.map((span) => span.attributes["appkit.usage"])).toEqual([
      {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 1,
        costAvailable: false,
      },
      {
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
        cacheReadInputTokens: 1,
        costAvailable: true,
        costUsd: 0.01,
      },
    ]);
    expect(models.map((span) => span.attributes["appkit.model"])).toEqual([
      "model-one",
      "model-two",
    ]);
    expect(models.map((span) => span.attributes["appkit.provider"])).toEqual([
      "databricks",
      "databricks",
    ]);
    for (const model of models) {
      expect(model.attributes["appkit.ttft_ms"]).toEqual(expect.any(Number));
      expect(model.attributes["appkit.stream_duration_ms"]).toEqual(
        expect.any(Number),
      );
      expect(
        model.attributes["appkit.stream_duration_ms"],
      ).toBeGreaterThanOrEqual(model.attributes["appkit.ttft_ms"]);
    }
    expect(models[0].attributes["appkit.cost_available"]).toBe(false);
    expect(models[0].attributes).not.toHaveProperty("appkit.cost_usd");
    expect(models[1].attributes["appkit.cost_available"]).toBe(true);
    expect(models[1].attributes["appkit.cost_usd"]).toBe(0.01);
    expect(roots[0].attributes["appkit.usage"]).toEqual({
      inputTokens: 15,
      outputTokens: 6,
      totalTokens: 21,
      cacheReadInputTokens: 4,
      cacheCreationInputTokens: 1,
      costAvailable: false,
    });
    expect(roots[0].attributes["appkit.usage"]).not.toHaveProperty("costUsd");
  });

  test("parses ChatDatabricks camelCase token usage", async () => {
    const runnable = {
      async invoke(_input: unknown, options?: Record<string, any>) {
        const callback = options?.callbacks?.[0];
        if (!callback)
          throw new Error("production invocation did not install tracing");

        await callback.handleChatModelStart(
          { id: ["databricks", "chat"] },
          [[{ role: "user", content: "count these tokens" }]],
          "adapter-model-run",
          undefined,
          { model: "databricks-adapter-model" },
          [],
          { ls_provider: "databricks" },
          "databricks-adapter-model",
        );
        await callback.handleLLMEnd(
          {
            generations: [
              [
                {
                  message: { content: "counted" },
                  generationInfo: { finish_reason: "stop" },
                },
              ],
            ],
            llmOutput: {
              tokenUsage: {
                promptTokens: 11,
                completionTokens: 5,
                totalTokens: 16,
                cacheReadInputTokens: 3,
                cacheCreationInputTokens: 2,
              },
            },
          },
          "adapter-model-run",
        );
        return { messages: [{ role: "assistant", content: "counted" }] };
      },
    };
    const agent = new StandardAgent(runnable as any, "helpful");

    await withAgentRequestTrace(
      { input: "count these tokens" },
      {
        sessionId: "session-usage",
        userId: "user-usage",
        requestId: "request-usage",
      },
      async () => agent.invoke({ input: "count these tokens" }),
    );

    const root = mlflowTest.__spans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    const model = mlflowTest.__spans.find(
      (span) => span.attributes["langchain.run_id"] === "adapter-model-run",
    );
    const expectedUsage = {
      inputTokens: 11,
      outputTokens: 5,
      totalTokens: 16,
      cacheReadInputTokens: 3,
      cacheCreationInputTokens: 2,
      costAvailable: false,
    };
    expect(model?.attributes["appkit.usage"]).toEqual(expectedUsage);
    expect(model?.attributes["mlflow.chat.tokenUsage"]).toEqual({
      input_tokens: 11,
      output_tokens: 5,
      total_tokens: 16,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
    });
    expect(root?.attributes["appkit.usage"]).toEqual(expectedUsage);
  });

  test("records complete tool success and error lifecycles by run ID", async () => {
    const runnable = {
      async invoke(_input: unknown, options?: Record<string, any>) {
        const callback = options?.callbacks?.[0];
        if (!callback)
          throw new Error("production invocation did not install tracing");
        await callback.handleChainStart(
          { id: ["langgraph", "agent"] },
          { question: "use tools" },
          "agent-tools",
        );
        await callback.handleToolStart(
          { id: ["tools", "weather"] },
          '{"city":"Paris"}',
          "tool-success",
          "agent-tools",
          [],
          {},
          "weather",
        );
        await callback.handleToolEnd(
          { temperature: 21, conditions: "sunny" },
          "tool-success",
          "agent-tools",
        );
        await callback.handleToolStart(
          { id: ["tools", "calendar"] },
          '{"date":"tomorrow"}',
          "tool-error",
          "agent-tools",
          [],
          {},
          "calendar",
        );
        await callback.handleToolError(
          new Error("calendar unavailable"),
          "tool-error",
          "agent-tools",
        );
        await callback.handleChainEnd(
          { answer: "partial result" },
          "agent-tools",
        );
        return { messages: [{ role: "assistant", content: "partial result" }] };
      },
    };
    const agent = new StandardAgent(runnable as any, "helpful");

    await withAgentRequestTrace(
      { input: "use tools" },
      { sessionId: "session-2", userId: "user-2", requestId: "request-2" },
      async () => agent.invoke({ input: "use tools" }),
    );

    const tools = mlflowTest.__spans.filter((span) => span.spanType === "TOOL");
    expect(tools.map((span) => span.attributes["langchain.run_id"])).toEqual([
      "tool-success",
      "tool-error",
    ]);
    expect(tools[0].inputs).toEqual({ city: "Paris" });
    expect(tools[0].outputs).toEqual({ temperature: 21, conditions: "sunny" });
    expect(tools[0].status.code).toBe("OK");
    expect(tools[1].inputs).toEqual({ date: "tomorrow" });
    expect(tools[1].outputs).toEqual({ error: "calendar unavailable" });
    expect(tools[1].status.code).toBe("ERROR");
    expect(tools[1].events).toEqual([
      { name: "exception", attributes: { message: "calendar unavailable" } },
    ]);
  });

  test("traces retrieval and nested agent decisions beneath the chain", async () => {
    const runnable = {
      async invoke(_input: unknown, options?: Record<string, any>) {
        const callback = options?.callbacks?.[0];
        if (!callback)
          throw new Error("production invocation did not install tracing");
        await callback.handleChainStart(
          { id: ["langgraph", "agent"] },
          { question: "find policy" },
          "agent-retrieval",
        );
        await callback.handleAgentAction(
          {
            tool: "policy_search",
            toolInput: { query: "refunds", apiKey: "action-secret" },
            log: "search",
          },
          "agent-retrieval",
        );
        await callback.handleRetrieverStart(
          { id: ["retrievers", "policy"] },
          "refund policy",
          "retriever-run",
          "agent-retrieval",
          [],
          {},
          "policy-retriever",
        );
        await callback.handleRetrieverEnd(
          [
            {
              pageContent: "Refunds are available for 30 days",
              metadata: { source: "policy" },
            },
          ],
          "retriever-run",
          "agent-retrieval",
        );
        await callback.handleAgentEnd(
          {
            returnValues: { output: "30 days" },
            log: "done",
            password: "finish-secret",
          },
          "agent-retrieval",
        );
        await callback.handleChainEnd({ answer: "30 days" }, "agent-retrieval");
        return { messages: [{ role: "assistant", content: "30 days" }] };
      },
    };
    const agent = new StandardAgent(runnable as any, "helpful");

    await withAgentRequestTrace(
      { input: "find policy" },
      { sessionId: "session-3", userId: "user-3", requestId: "request-3" },
      async () => agent.invoke({ input: "find policy" }),
    );

    const root = mlflowTest.__spans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    const chain = mlflowTest.__spans.find(
      (span) =>
        span.spanType === "CHAIN" &&
        span.attributes["langchain.run_id"] === "agent-retrieval",
    );
    const retriever = mlflowTest.__spans.find(
      (span) => span.spanType === "RETRIEVER",
    );
    expect(root).toBeDefined();
    expect(chain?.parentId).toBe(root?.spanId);
    expect(retriever?.parentId).toBe(chain?.spanId);
    expect(retriever?.attributes["langchain.run_id"]).toBe("retriever-run");
    expect(retriever?.inputs).toEqual({ query: "refund policy" });
    expect(retriever?.outputs).toEqual([
      {
        pageContent: "Refunds are available for 30 days",
        metadata: { source: "policy" },
      },
    ]);
    const decisions = mlflowTest.__spans.filter(
      (span) =>
        span.spanType === "CHAIN" &&
        ["langchain.agent.action", "langchain.agent.end"].includes(span.name),
    );
    expect(decisions).toHaveLength(2);
    expect(decisions.map((span) => span.parentId)).toEqual([
      chain?.spanId,
      chain?.spanId,
    ]);
    expect(
      decisions.map((span) => span.attributes["langchain.run_id"]),
    ).toEqual(["agent-retrieval", "agent-retrieval"]);
    expect(decisions.map((span) => span.inputs)).toEqual([
      {
        tool: "policy_search",
        toolInput: { query: "refunds", apiKey: "[REDACTED]" },
        log: "search",
      },
      {
        returnValues: { output: "30 days" },
        log: "done",
        password: "[REDACTED]",
      },
    ]);
    expect(decisions.map((span) => span.outputs)).toEqual([
      {
        tool: "policy_search",
        toolInput: { query: "refunds", apiKey: "[REDACTED]" },
        log: "search",
      },
      {
        returnValues: { output: "30 days" },
        log: "done",
        password: "[REDACTED]",
      },
    ]);
    expect(decisions.map((span) => span.status.code)).toEqual(["OK", "OK"]);
    expect(chain?.events).toEqual([]);
    expect(JSON.stringify(decisions)).not.toContain("action-secret");
    expect(JSON.stringify(decisions)).not.toContain("finish-secret");
  });

  test("preserves real RunnableSequence names and nested chain parents", async () => {
    const sequence = RunnableSequence.from([
      RunnableLambda.from(
        async (input: Record<string, unknown>) => input,
      ).withConfig({ runName: "prepare-input" }),
      RunnableLambda.from(async () => ({
        messages: [{ role: "assistant", content: "nested answer" }],
      })).withConfig({ runName: "produce-answer" }),
    ]).withConfig({ runName: "outer-sequence" });
    const agent = new StandardAgent(sequence as any, "helpful");

    await withAgentRequestTrace(
      { input: "run nested chains" },
      {
        sessionId: "session-nested",
        userId: "user-nested",
        requestId: "request-nested",
      },
      async () => agent.invoke({ input: "run nested chains" }),
    );

    const chains = mlflowTest.__spans.filter(
      (span) => span.spanType === "CHAIN",
    );
    expect(chains.map((span) => span.name)).toEqual([
      "outer-sequence",
      "prepare-input",
      "produce-answer",
    ]);
    const [outer, prepare, produce] = chains;
    expect(prepare.parentId).toBe(outer.spanId);
    expect(produce.parentId).toBe(outer.spanId);
    expect(prepare.attributes["langchain.parent_run_id"]).toBe(
      outer.attributes["langchain.run_id"],
    );
    expect(produce.attributes["langchain.parent_run_id"]).toBe(
      outer.attributes["langchain.run_id"],
    );
  });

  test("bounds complete captures and redacts structured and free-form secrets", async () => {
    await withAgentRequestTrace(
      {
        prompt: "summarize",
        authorization: "Bearer root-secret",
        notes: "Authorization: Bearer escaped-secret",
        payload: "x".repeat(70_000),
      },
      { sessionId: "session-4", userId: "user-4", requestId: "request-4" },
      async (trace) => {
        trace.setOutputs({
          answer: "done",
          apiKey: "output-secret",
          detail: "password='quoted-secret'",
        });
        return "done";
      },
    );

    const root = mlflowTest.__spans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    expect(root?.inputs).toEqual({
      truncated: true,
      originalBytes: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      preview: expect.any(String),
    });
    expect((root?.inputs as any).originalBytes).toBeGreaterThan(65_536);
    expect((root?.inputs as any).preview).toContain("[REDACTED]");
    expect(JSON.stringify(root?.inputs)).not.toContain("root-secret");
    expect(JSON.stringify(root?.inputs)).not.toContain("escaped-secret");
    expect(root?.outputs).toEqual({
      answer: "done",
      apiKey: "[REDACTED]",
      detail: "password='[REDACTED]'",
    });
  });

  test("records and rethrows request failures without exposing secrets", async () => {
    await expect(
      withAgentRequestTrace(
        { input: "fail" },
        { sessionId: "session-5", userId: "user-5", requestId: "request-5" },
        async () => {
          throw new Error("Authorization: Bearer request-secret");
        },
      ),
    ).rejects.toThrow("Authorization: [REDACTED]");

    const root = mlflowTest.__spans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    expect(root?.status.code).toBe("ERROR");
    expect(root?.outputs).toEqual({ error: "Authorization: [REDACTED]" });
    expect(JSON.stringify(root)).not.toContain("request-secret");
  });

  test("keeps a handled streaming failure marked as an error", async () => {
    const result = await withAgentRequestTrace(
      { input: "stream failure" },
      { sessionId: "session-6", userId: "user-6", requestId: "request-6" },
      async (trace) => {
        return trace.recordError(
          new Error("Authorization: Bearer stream-secret"),
        );
      },
    );

    expect(result.value).toBe("Authorization: [REDACTED]");
    const root = mlflowTest.__spans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    expect(root?.status.code).toBe("ERROR");
    expect(root?.outputs).toEqual({ error: "Authorization: [REDACTED]" });
    expect(JSON.stringify(root)).not.toContain("stream-secret");
  });

  test("bounds streaming capture incrementally", () => {
    const capture = new BoundedTraceAccumulator(1024);
    for (let index = 0; index < 20; index += 1) {
      capture.add({ index, delta: "x".repeat(200), token: `secret-${index}` });
    }

    const snapshot = capture.snapshot();
    expect(snapshot).toEqual({
      truncated: true,
      originalBytes: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      preview: expect.any(String),
    });
    expect((snapshot as any).originalBytes).toBeGreaterThan(1024);
    expect(
      Buffer.byteLength((snapshot as any).preview, "utf8"),
    ).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(snapshot)).not.toContain("secret-0");
  });

  test("logs but does not propagate runtime export failures", async () => {
    jest
      .mocked(mlflow.flushTraces)
      .mockRejectedValueOnce(
        new Error("Authorization: Bearer exporter-secret"),
      );
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(flushTracing()).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      "MLflow trace export failed during flush:",
      "Authorization: [REDACTED]",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("exporter-secret");
    log.mockRestore();
  });
});
