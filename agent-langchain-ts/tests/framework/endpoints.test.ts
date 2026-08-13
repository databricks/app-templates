/**
 * Integration tests for API endpoints
 * Tests both /invocations (Responses API) and /api/chat (AI SDK + useChat)
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  jest,
} from "@jest/globals";

jest.mock("@mlflow/core", () => {
  let nextTraceId = 1;
  let activeSpan: Record<string, any> | null = null;

  return {
    SpanType: { AGENT: "AGENT" },
    SpanStatusCode: { OK: "OK", ERROR: "ERROR" },
    init: jest.fn(),
    updateCurrentTrace: jest.fn(),
    getCurrentActiveSpan: () => activeSpan,
    startSpan: jest.fn(),
    withSpan: async (callback: (span: Record<string, any>) => unknown) => {
      const span = {
        traceId: `trace:/catalog_test.schema_test.langchain_test/${(nextTraceId++).toString(16).padStart(32, "0")}`,
        setInputs: jest.fn(),
        setOutputs: jest.fn(),
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        recordException: jest.fn(),
      };
      const previous = activeSpan;
      activeSpan = span;
      try {
        return await callback(span);
      } finally {
        activeSpan = previous;
      }
    },
    flushTraces: jest.fn(async () => undefined),
  };
});

import type { Server } from "http";
import express from "express";
import OpenAI from "openai";
import type { AgentInterface } from "../../src/framework/agent-interface.js";
import { createInvocationsRouter } from "../../src/framework/routes/invocations.js";
import { StubAgent } from "./stub-agent.js";
import {
  flushTracing,
  initializeTracing,
} from "../../src/framework/tracing.js";

describe("API Endpoints", () => {
  let server: Server;
  let baseUrl: string;
  let client: OpenAI;
  const allowedOrigins = new Set<string>();
  const externalRequests: string[] = [];
  const nativeFetch = globalThis.fetch;
  let restoreFetchGuard: (() => void) | undefined;

  beforeAll(async () => {
    process.env.MLFLOW_TRACKING_URI = "http://127.0.0.1:65535";
    process.env.MLFLOW_EXPERIMENT_ID = "123456789";
    process.env.MLFLOW_UC_CATALOG = "catalog_test";
    process.env.MLFLOW_UC_SCHEMA = "schema_test";
    process.env.MLFLOW_UC_TABLE_PREFIX = "langchain_test";
    initializeTracing();

    const app = express();
    app.use(express.json());
    const router = createInvocationsRouter(new StubAgent());
    app.use("/invocations", router);
    app.use("/responses", router);
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    allowedOrigins.add(baseUrl);

    const fetchGuard = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (!allowedOrigins.has(url.origin)) {
          externalRequests.push(url.toString());
          throw new Error(`Unit test attempted external request: ${url}`);
        }
        return nativeFetch(input, init);
      });
    restoreFetchGuard = () => fetchGuard.mockRestore();

    client = new OpenAI({ baseURL: baseUrl, apiKey: "not-needed" });
  }, 30000);

  afterEach(async () => {
    await flushTracing();
    const attempted = externalRequests.splice(0);
    expect(attempted).toEqual([]);
  });

  afterAll(async () => {
    await flushTracing();
    restoreFetchGuard?.();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  describe("/invocations endpoint", () => {
    test("returns the V4 MLflow trace ID for a streaming request", async () => {
      const response = await fetch(`${baseUrl}/invocations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": "session-stream",
          "X-User-Id": "user-stream",
          "X-Request-Id": "request-stream",
        },
        body: JSON.stringify({
          input: [{ role: "user", content: "trace this stream" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-mlflow-trace-id")).toMatch(
        /^trace:\/catalog_test\.schema_test\.langchain_test\/[0-9a-f]{32}$/,
      );
      await response.text();
    });

    test("returns the same V4 MLflow trace ID for a non-streaming request", async () => {
      const response = await fetch(`${baseUrl}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [{ role: "user", content: "trace this response" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(200);
      const traceId = response.headers.get("x-mlflow-trace-id");
      expect(traceId).toMatch(
        /^trace:\/catalog_test\.schema_test\.langchain_test\/[0-9a-f]{32}$/,
      );
      const body = (await response.json()) as { trace_id?: string };
      expect(body.trace_id).toBe(traceId);
    });

    test("returns the V4 MLflow trace ID when a non-streaming invocation fails", async () => {
      const failingAgent: AgentInterface = {
        async invoke() {
          throw new Error("expected invocation failure");
        },
        async *stream() {
          throw new Error("stream should not be called");
        },
      };
      const app = express();
      app.use(express.json());
      app.use("/invocations", createInvocationsRouter(failingAgent));
      const server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, () => resolve(listener));
      });
      const errorLog = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("test server did not bind to a TCP port");
        }
        const origin = `http://127.0.0.1:${address.port}`;
        allowedOrigins.add(origin);
        const response = await fetch(`${origin}/invocations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: [{ role: "user", content: "fail with a trace" }],
            stream: false,
          }),
        });

        expect(response.status).toBe(500);
        expect(response.headers.get("x-mlflow-trace-id")).toMatch(
          /^trace:\/catalog_test\.schema_test\.langchain_test\/[0-9a-f]{32}$/,
        );
        await flushTracing();
        expect(errorLog).toHaveBeenCalledWith(
          "Agent invocation error:",
          expect.objectContaining({ message: "expected invocation failure" }),
        );
      } finally {
        await flushTracing();
        errorLog.mockRestore();
        const address = server.address();
        if (address && typeof address !== "string") {
          allowedOrigins.delete(`http://127.0.0.1:${address.port}`);
        }
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });

    test("should respond with Responses API format", async () => {
      const stream = await client.responses.create({
        model: "test-model",
        input: [{ role: "user", content: "Say 'test' and nothing else" }],
        stream: true,
      });

      let fullText = "";
      let hasTextDelta = false;
      let hasCompleted = false;

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          fullText += event.delta;
          hasTextDelta = true;
        }
        if (event.type === "response.completed") {
          hasCompleted = true;
        }
      }

      expect(hasTextDelta).toBe(true);
      expect(hasCompleted).toBe(true);
    }, 30000);

    test("should work via /responses alias", async () => {
      // The /responses alias allows the OpenAI SDK to use the endpoint natively
      const stream = await client.responses.create({
        model: "test-model",
        input: [{ role: "user", content: "Say 'SDK test'" }],
        stream: true,
      });

      let hasTextDelta = false;

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          hasTextDelta = true;
        }
      }

      expect(hasTextDelta).toBe(true);
    }, 30000);
  });
});
