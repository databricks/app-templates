import { mkdtemp, rm } from "node:fs/promises";
import http, { type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";

interface CapturedSpan {
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
}

import * as mlflow from "@mlflow/core";
import { Config, ConfigError } from "@databricks/sdk-experimental";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import {
  BoundedTraceAccumulator,
  buildTracingConfig,
  flushTracing,
  initializeTracing,
  safeLogError,
  withAgentRequestTrace,
} from "../../src/framework/tracing.js";
import { StandardAgent } from "../../src/agent.js";

const mlflowSpans: CapturedSpan[] = [];
const exporterRequests: Array<{
  url: string;
  headers: http.IncomingHttpHeaders;
  json?: Record<string, any>;
}> = [];
let exporterServer: Server;
let artifactDirectory: string;

const REQUIRED_ENV = [
  "MLFLOW_EXPERIMENT_ID",
  "MLFLOW_UC_CATALOG",
  "MLFLOW_UC_SCHEMA",
  "MLFLOW_UC_TABLE_PREFIX",
] as const;

const originalEnv = { ...process.env };

const CREDENTIAL_SENTINEL = "task14-round4-sentinel.with/suffix+=tail";
const CREDENTIAL_MESSAGE_CASES: Array<
  [label: string, credentialText: string, redactedText: string]
> = [
  [
    "authorization",
    `Authorization: Bearer ${CREDENTIAL_SENTINEL}`,
    "Authorization: [REDACTED]",
  ],
  [
    "authorization header",
    `Authorization header: Bearer ${CREDENTIAL_SENTINEL}`,
    "Authorization header: [REDACTED]",
  ],
  [
    "authorization_header",
    `authorization_header=Bearer ${CREDENTIAL_SENTINEL}`,
    "authorization_header=[REDACTED]",
  ],
  [
    "authorizationHeader",
    `authorizationHeader: \"Bearer ${CREDENTIAL_SENTINEL}\"`,
    'authorizationHeader: "[REDACTED]"',
  ],
  ["cookie", `Cookie: session=${CREDENTIAL_SENTINEL}`, "Cookie: [REDACTED]"],
  [
    "cookie header",
    `Cookie header: session=${CREDENTIAL_SENTINEL}`,
    "Cookie header: [REDACTED]",
  ],
  [
    "set-cookie",
    `Set-Cookie: \"session=${CREDENTIAL_SENTINEL}\"`,
    'Set-Cookie: "[REDACTED]"',
  ],
  ["API key", `API key: ${CREDENTIAL_SENTINEL}`, "API key: [REDACTED]"],
  ["api-key", `api-key=${CREDENTIAL_SENTINEL}`, "api-key=[REDACTED]"],
  [
    "api_key",
    `api_key is \"${CREDENTIAL_SENTINEL}\"`,
    'api_key is "[REDACTED]"',
  ],
  ["apiKey", `apiKey: ${CREDENTIAL_SENTINEL}`, "apiKey: [REDACTED]"],
  ["x-api-key", `x-api-key=${CREDENTIAL_SENTINEL}`, "x-api-key=[REDACTED]"],
  [
    "Databricks token",
    `Databricks token is ${CREDENTIAL_SENTINEL}`,
    "Databricks token is [REDACTED]",
  ],
  [
    "DATABRICKS_TOKEN",
    `DATABRICKS_TOKEN=${CREDENTIAL_SENTINEL}`,
    "DATABRICKS_TOKEN=[REDACTED]",
  ],
  [
    "databricksToken",
    `databricksToken: '${CREDENTIAL_SENTINEL}'`,
    "databricksToken: '[REDACTED]'",
  ],
  [
    "access token",
    `access token is ${CREDENTIAL_SENTINEL}`,
    "access token is [REDACTED]",
  ],
  [
    "access-token",
    `access-token=Bearer ${CREDENTIAL_SENTINEL}`,
    "access-token=[REDACTED]",
  ],
  [
    "access_token",
    `access_token: ${CREDENTIAL_SENTINEL}`,
    "access_token: [REDACTED]",
  ],
  [
    "accessToken",
    `accessToken=\"${CREDENTIAL_SENTINEL}\"`,
    'accessToken="[REDACTED]"',
  ],
  [
    "refresh token",
    `refresh token is ${CREDENTIAL_SENTINEL}`,
    "refresh token is [REDACTED]",
  ],
  [
    "refresh-token",
    `refresh-token: '${CREDENTIAL_SENTINEL}'`,
    "refresh-token: '[REDACTED]'",
  ],
  [
    "refresh_token",
    `refresh_token=${CREDENTIAL_SENTINEL}`,
    "refresh_token=[REDACTED]",
  ],
  [
    "refreshToken",
    `refreshToken=${CREDENTIAL_SENTINEL}`,
    "refreshToken=[REDACTED]",
  ],
  [
    "client secret",
    `client secret is ${CREDENTIAL_SENTINEL}`,
    "client secret is [REDACTED]",
  ],
  [
    "client-secret",
    `client-secret=${CREDENTIAL_SENTINEL}`,
    "client-secret=[REDACTED]",
  ],
  [
    "client_secret",
    `client_secret: \"${CREDENTIAL_SENTINEL}\"`,
    'client_secret: "[REDACTED]"',
  ],
  [
    "clientSecret",
    `clientSecret=${CREDENTIAL_SENTINEL}`,
    "clientSecret=[REDACTED]",
  ],
  ["password", `password is ${CREDENTIAL_SENTINEL}`, "password is [REDACTED]"],
  [
    "generic secret",
    `secret: '${CREDENTIAL_SENTINEL}'`,
    "secret: '[REDACTED]'",
  ],
  [
    "generic credential",
    `credential is ${CREDENTIAL_SENTINEL}`,
    "credential is [REDACTED]",
  ],
];

beforeAll(async () => {
  artifactDirectory = await mkdtemp(join(tmpdir(), "mlflow-core-test-"));
  exporterServer = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const json = request.headers["content-type"]?.includes("application/json")
        ? (JSON.parse(body.toString("utf8")) as Record<string, any>)
        : undefined;
      const traceInfo = json?.trace?.trace_info;
      if (traceInfo) {
        traceInfo.tags = {
          ...(traceInfo.tags ?? {}),
          "mlflow.artifactLocation": pathToFileURL(artifactDirectory).href,
        };
      }
      exporterRequests.push({
        url: request.url ?? "",
        headers: request.headers,
        ...(json ? { json } : {}),
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(json ?? {}));
    });
  });
  await new Promise<void>((resolve) =>
    exporterServer.listen(0, "127.0.0.1", resolve),
  );
  const address = exporterServer.address();
  if (!address || typeof address === "string") {
    throw new Error("loopback MLflow exporter did not bind a TCP port");
  }
  mlflow.registerOnSpanEndHook((span) => {
    mlflowSpans.push({
      traceId: span.traceId,
      spanId: span.spanId,
      parentId: span.parentId,
      name: span.name,
      spanType: span.spanType,
      inputs: span.inputs,
      outputs: span.outputs,
      attributes: span.attributes,
      status: {
        code: span.status.statusCode,
        ...(span.status.description
          ? { description: span.status.description }
          : {}),
      },
      events: span.events.map((event) => ({
        name: event.name,
        attributes: event.attributes?.["exception.message"]
          ? { message: event.attributes["exception.message"] }
          : event.attributes,
      })),
    });
  });
  mlflow.init({
    trackingUri: `http://127.0.0.1:${address.port}`,
    experimentId: "123456789",
  });
});

afterEach(async () => {
  await flushTracing();
  process.env = { ...originalEnv };
  mlflowSpans.length = 0;
  exporterRequests.length = 0;
});

afterAll(async () => {
  await flushTracing();
  await new Promise<void>((resolve, reject) => {
    exporterServer.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(artifactDirectory, { recursive: true, force: true });
});

describe("MLflow tracing", () => {
  test.each(CREDENTIAL_MESSAGE_CASES)(
    "redacts %s credentials without leaking a value suffix",
    (_label, credentialText, redactedText) => {
      const message = safeLogError(
        new Error(`Request failed; ${credentialText}; retry later.`),
      ).message;

      expect(message).toBe(`Request failed; ${redactedText}; retry later.`);
      expect(message).not.toContain(CREDENTIAL_SENTINEL);
      expect(message).not.toContain("suffix+=tail");
    },
  );

  test("preserves ordinary error context containing credential-related words", () => {
    const message =
      "The token budget is 4096; authorization failed after timeout; " +
      "the cookie parser failed; secret rotation is enabled; " +
      "credential validation remains unavailable.";

    expect(safeLogError(new Error(message)).message).toBe(message);
  });

  test("does not traverse or enumerate sensitive error properties", () => {
    const forbiddenAccesses = {
      config: 0,
      env: 0,
      headers: 0,
      cookies: 0,
    };
    let enumerationAccesses = 0;
    const guardedErrorTarget = Object.assign(
      new Error(`clientSecret=${CREDENTIAL_SENTINEL}`),
      {
        name: "ConfigError",
        code: "UNAUTHENTICATED",
      },
    );

    Object.defineProperties(guardedErrorTarget, {
      config: {
        get: () => {
          forbiddenAccesses.config += 1;
          throw new Error("config getter traversed");
        },
      },
      env: {
        get: () => {
          forbiddenAccesses.env += 1;
          throw new Error("env getter traversed");
        },
      },
      headers: {
        get: () => {
          forbiddenAccesses.headers += 1;
          throw new Error("headers getter traversed");
        },
      },
      cookies: {
        get: () => {
          forbiddenAccesses.cookies += 1;
          throw new Error("cookies getter traversed");
        },
      },
    });

    const guardedError = new Proxy(guardedErrorTarget, {
      ownKeys() {
        enumerationAccesses += 1;
        throw new Error("safeLogError must not enumerate the error object");
      },
    });

    expect(safeLogError(guardedError)).toEqual({
      name: "ConfigError",
      code: "UNAUTHENTICATED",
      message: "clientSecret=[REDACTED]",
    });
    expect(forbiddenAccesses).toEqual({
      config: 0,
      env: 0,
      headers: 0,
      cookies: 0,
    });
    expect(enumerationAccesses).toBe(0);
  });

  test("reduces SDK configuration errors to safe actionable fields", () => {
    const sentinelCredential = "test-only-sentinel-value";
    const environmentMarker = "TEST_FULL_ENV_MARKER";
    const sdkConfig = new Config({
      env: {
        DATABRICKS_TOKEN: sentinelCredential,
        [environmentMarker]: "present-only-in-sdk-config",
      },
    });
    const error = new ConfigError(
      [
        "authentication failed",
        `Authorization: Bearer ${sentinelCredential}`,
        `Cookie: session=${sentinelCredential}`,
        `x-api-key=${sentinelCredential}`,
        `DATABRICKS_TOKEN=${sentinelCredential}`,
        `CLIENT_SECRET=${sentinelCredential}`,
      ].join("; "),
      sdkConfig,
    ) as ConfigError & { code: string };
    error.code = "UNAUTHENTICATED";

    const output = JSON.stringify(safeLogError(error));

    expect(output).toContain("ConfigError");
    expect(output).toContain("UNAUTHENTICATED");
    expect(output).toContain("authentication failed");
    expect(output).toContain("Authorization: [REDACTED]");
    expect(output).not.toContain(sentinelCredential);
    expect(output).not.toContain(environmentMarker);
    expect(output).not.toContain("present-only-in-sdk-config");
  });

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

  test("builds the exact UC trace location for MLflow core", () => {
    process.env.MLFLOW_TRACKING_URI = "   ";
    process.env.MLFLOW_EXPERIMENT_ID = "123456789";
    process.env.MLFLOW_UC_CATALOG = "catalog_test";
    process.env.MLFLOW_UC_SCHEMA = "schema_test";
    process.env.MLFLOW_UC_TABLE_PREFIX = "langchain_test";

    expect(buildTracingConfig()).toEqual({
      trackingUri: "databricks",
      experimentId: "123456789",
      traceLocation: {
        catalogName: "catalog_test",
        schemaName: "schema_test",
        tablePrefix: "langchain_test",
      },
    });
  });

  test("sets app, session, user, and request identity on the exported trace", async () => {
    process.env.DATABRICKS_APP_NAME = "deployed-langchain-agent";

    await withAgentRequestTrace(
      { input: "identify this trace" },
      {
        sessionId: "session-123",
        userId: "user-456",
        requestId: "request-789",
      },
      async (trace) => {
        trace.setOutputs({ output: "identified" });
        return "identified";
      },
    );
    await mlflow.flushTraces();

    const infoRequest = exporterRequests.find((request) =>
      request.url.endsWith("/api/3.0/mlflow/traces"),
    );
    expect(infoRequest?.json?.trace?.trace_info?.trace_metadata).toMatchObject({
      "mlflow.trace.session": "session-123",
      "mlflow.trace.user": "user-456",
      "appkit.app.name": "deployed-langchain-agent",
      "appkit.request.id": "request-789",
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

    const roots = mlflowSpans.filter(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    const models = mlflowSpans.filter((span) => span.spanType === "CHAT_MODEL");
    expect(roots).toHaveLength(1);
    expect(roots[0].status.code).toBe("STATUS_CODE_OK");
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

    const root = mlflowSpans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    const model = mlflowSpans.find(
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

    const tools = mlflowSpans.filter((span) => span.spanType === "TOOL");
    expect(tools.map((span) => span.attributes["langchain.run_id"])).toEqual([
      "tool-success",
      "tool-error",
    ]);
    expect(tools[0].inputs).toEqual({ city: "Paris" });
    expect(tools[0].outputs).toEqual({ temperature: 21, conditions: "sunny" });
    expect(tools[0].status.code).toBe("STATUS_CODE_OK");
    expect(tools[1].inputs).toEqual({ date: "tomorrow" });
    expect(tools[1].outputs).toEqual({
      partial_output: { available: false, reason: "no output produced" },
      error: "calendar unavailable",
    });
    expect(tools[1].status.code).toBe("STATUS_CODE_ERROR");
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

    const root = mlflowSpans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    const chain = mlflowSpans.find(
      (span) =>
        span.spanType === "CHAIN" &&
        span.parentId === root?.spanId &&
        span.attributes["langchain.run_id"] === "agent-retrieval",
    );
    const retriever = mlflowSpans.find((span) => span.spanType === "RETRIEVER");
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
    const decisions = mlflowSpans.filter(
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
    expect(decisions.map((span) => span.status.code)).toEqual([
      "STATUS_CODE_OK",
      "STATUS_CODE_OK",
    ]);
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

    const chains = mlflowSpans.filter((span) => span.spanType === "CHAIN");
    expect(chains.map((span) => span.name).sort()).toEqual(
      ["outer-sequence", "prepare-input", "produce-answer"].sort(),
    );
    const outer = chains.find((span) => span.name === "outer-sequence")!;
    const prepare = chains.find((span) => span.name === "prepare-input")!;
    const produce = chains.find((span) => span.name === "produce-answer")!;
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

    const root = mlflowSpans.find(
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

    const root = mlflowSpans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    expect(root?.status.code).toBe("STATUS_CODE_ERROR");
    expect(root?.outputs).toEqual({
      partial_output: { available: false, reason: "no output produced" },
      error: "Authorization: [REDACTED]",
    });
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
    const root = mlflowSpans.find(
      (span) => span.spanType === "AGENT" && span.parentId === null,
    );
    expect(root?.status.code).toBe("STATUS_CODE_ERROR");
    expect(root?.outputs).toEqual({
      partial_output: { available: false, reason: "no output produced" },
      error: "Authorization: [REDACTED]",
    });
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
});
