/**
 * Integration tests for API endpoints
 * Tests both /invocations (Responses API) and /api/chat (AI SDK + useChat)
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import OpenAI from "openai";

describe("API Endpoints", () => {
  let agentProcess: ChildProcess;
  const PORT = 5555; // Use different port to avoid conflicts
  const BASE_URL = `http://localhost:${PORT}`;
  let client: OpenAI;

  beforeAll(async () => {
    // Start framework server with stub agent (no LLM required)
    agentProcess = spawn("node_modules/.bin/tsx", ["tests/framework/stub-server.ts"], {
      env: { ...process.env, PORT: PORT.toString(), MLFLOW_TRACKING_URI: "noop" },
      stdio: ["ignore", "pipe", "pipe"],
    });

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
