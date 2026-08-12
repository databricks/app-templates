/**
 * Integration tests for API endpoints
 * Tests both /invocations (Responses API) and /api/chat (AI SDK + useChat)
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import type { Server } from "http";
import express from "express";
import OpenAI from "openai";
import type { AgentInterface } from "../../src/framework/agent-interface.js";
import { createInvocationsRouter } from "../../src/framework/routes/invocations.js";
import { initializeTracing } from "../../src/framework/tracing.js";

describe("API Endpoints", () => {
  let agentProcess: ChildProcess;
  const PORT = 5555; // Use different port to avoid conflicts
  const BASE_URL = `http://localhost:${PORT}`;
  let client: OpenAI;

  beforeAll(async () => {
    // Start framework server with stub agent (no LLM required)
    agentProcess = spawn(
      "node_modules/.bin/tsx",
      ["tests/framework/stub-server.ts"],
      {
        env: {
          ...process.env,
          PORT: PORT.toString(),
          MLFLOW_TRACKING_URI: "http://127.0.0.1:65535",
          MLFLOW_EXPERIMENT_ID: "123456789",
          MLFLOW_UC_CATALOG: "catalog_test",
          MLFLOW_UC_SCHEMA: "schema_test",
          MLFLOW_UC_TABLE_PREFIX: "langchain_test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // Poll /health until server is ready (max 20s)
    const start = Date.now();
    while (Date.now() - start < 20000) {
      try {
        const r = await fetch(`${BASE_URL}/health`);
        if (r.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }

    client = new OpenAI({ baseURL: BASE_URL, apiKey: "not-needed" });
  }, 30000);

  afterAll(async () => {
    if (agentProcess) {
      agentProcess.kill();
    }
  });

  describe("/invocations endpoint", () => {
    test("returns the V4 MLflow trace ID for a streaming request", async () => {
      const response = await fetch(`${BASE_URL}/invocations`, {
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
      const response = await fetch(`${BASE_URL}/invocations`, {
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
      process.env.MLFLOW_TRACKING_URI = "http://127.0.0.1:65535";
      process.env.MLFLOW_EXPERIMENT_ID = "123456789";
      process.env.MLFLOW_UC_CATALOG = "catalog_test";
      process.env.MLFLOW_UC_SCHEMA = "schema_test";
      process.env.MLFLOW_UC_TABLE_PREFIX = "langchain_test";
      initializeTracing();

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

      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("test server did not bind to a TCP port");
        }
        const response = await fetch(
          `http://127.0.0.1:${address.port}/invocations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: [{ role: "user", content: "fail with a trace" }],
              stream: false,
            }),
          },
        );

        expect(response.status).toBe(500);
        expect(response.headers.get("x-mlflow-trace-id")).toMatch(
          /^trace:\/catalog_test\.schema_test\.langchain_test\/[0-9a-f]{32}$/,
        );
      } finally {
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
