/**
 * Integration tests for local agent endpoints
 * Tests both /invocations and /api/chat
 *
 * Spawns agent and UI servers automatically — no external setup required.
 *
 * Run with: npm test tests/integration.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { createDatabricksProvider } from "@databricks/ai-sdk-provider";
import { streamText } from "ai";
import {
  parseSSEStream,
  parseAISDKStream,
} from '../helpers.js';

const AGENT_PORT = 5556;
const UI_PORT = 5557;
const AGENT_URL = `http://localhost:${AGENT_PORT}`;
const UI_URL = `http://localhost:${UI_PORT}`;

describe("Integration Tests - Local Endpoints", () => {
  let agentProcess: ChildProcess;
  let uiProcess: ChildProcess;

  beforeAll(async () => {
    // Start agent server
    agentProcess = spawn("tsx", ["src/framework/server.ts"], {
      env: { ...process.env, PORT: AGENT_PORT.toString() },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Start UI server with API_PROXY pointing to agent
    uiProcess = spawn(
      "../node_modules/tsx/dist/cli.mjs",
      ["server/src/index.ts"],
      {
        cwd: `${process.cwd()}/../e2e-chatbot-app-next`,
        env: {
          ...process.env,
          CHAT_APP_PORT: UI_PORT.toString(),
          API_PROXY: `${AGENT_URL}/invocations`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Poll /health until agent server is ready (max 20s)
    const agentStart = Date.now();
    while (Date.now() - agentStart < 20000) {
      try {
        const r = await fetch(`${AGENT_URL}/health`);
        if (r.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }

    // Poll /ping until UI server is ready (max 20s)
    const uiStart = Date.now();
    while (Date.now() - uiStart < 20000) {
      try {
        const r = await fetch(`${UI_URL}/ping`);
        if (r.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 60000);

  afterAll(async () => {
    if (agentProcess) agentProcess.kill();
    if (uiProcess) uiProcess.kill();
  });

  describe("/invocations endpoint", () => {
    test("should respond with Databricks provider", async () => {
      const databricks = createDatabricksProvider({
        baseURL: AGENT_URL,
        formatUrl: ({ baseUrl, path }) => {
          if (path === "/responses") {
            return `${baseUrl}/invocations`;
          }
          return `${baseUrl}${path}`;
        },
      });

      const result = streamText({
        model: databricks.responses("test-model"),
        messages: [
          { role: "user", content: "Say exactly: Databricks provider test successful" },
        ],
      });

      let fullText = "";
      for await (const chunk of result.textStream) {
        fullText += chunk;
      }

      expect(fullText.toLowerCase()).toContain("databricks");
      expect(fullText.toLowerCase()).toContain("successful");
    }, 30000);

    test("should handle tool calling (time tool)", async () => {
      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [{ role: "user", content: "What time is it in Tokyo?" }],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();
      const { fullOutput, hasToolCall } = parseSSEStream(text);

      expect(hasToolCall).toBe(true);
      expect(fullOutput.toLowerCase()).toMatch(/tokyo|time/);
    }, 30000);
  });

  describe("/api/chat endpoint", () => {
    test("should respond with useChat format", async () => {
      const response = await fetch(`${UI_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "550e8400-e29b-41d4-a716-446655440000",
          message: {
            role: "user",
            parts: [{ type: "text", text: "Say hello" }],
            id: "550e8400-e29b-41d4-a716-446655440001",
          },
          selectedChatModel: "chat-model",
          selectedVisibilityType: "private",
          nextMessageId: "550e8400-e29b-41d4-a716-446655440002",
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();
      const { hasTextDelta } = parseAISDKStream(text);

      expect(hasTextDelta).toBe(true);
    }, 30000);
  });
});
