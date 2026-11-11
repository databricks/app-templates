/**
 * Error handling tests for agent endpoints
 * Tests error scenarios including SSE completion and request validation
 *
 * Run with: npm run test:integration
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import {
  parseSSEStream,
  assertStreamComplete,
} from '../helpers.js';

const PORT = 5558;
const AGENT_URL = `http://localhost:${PORT}`;
let agentProcess: ChildProcess;

beforeAll(async () => {
  agentProcess = spawn("node_modules/.bin/tsx", ["tests/framework/stub-server.ts"], {
    env: { ...process.env, PORT: PORT.toString(), MLFLOW_TRACKING_URI: "noop" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try {
      const r = await fetch(`${AGENT_URL}/health`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
}, 30000);

afterAll(() => {
  if (agentProcess) agentProcess.kill();
});

describe("Error Handling Tests", () => {
  describe("SSE Stream Completion", () => {
    test("should send completion events on successful response", async () => {
      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [{ role: "user", content: "Say 'test'" }],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();
      const { events } = parseSSEStream(text);

      // Verify proper SSE completion sequence
      assertStreamComplete(text);
      expect(events.some(e => e.type === "response.completed" || e.type === "response.failed")).toBe(true);

      // Ensure it ends with [DONE]
      const lines = text.trim().split("\n");
      const lastDataLine = lines
        .filter(line => line.startsWith("data:"))
        .pop();
      expect(lastDataLine).toBe("data: [DONE]");
    }, 30000);

    test("should handle malformed input gracefully", async () => {
      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Missing required 'input' field
          stream: true,
        }),
      });

      // Should return error status
      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    }, 30000);
  });

  describe("Request Size Limits", () => {
    test("should reject payloads exceeding 10MB limit", async () => {
      // Create a payload larger than 10MB
      const largeMessage = "A".repeat(11 * 1024 * 1024); // 11MB

      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [
            { role: "user", content: largeMessage }
          ],
          stream: true,
        }),
      });

      // Should reject with 413 (Payload Too Large)
      expect(response.ok).toBe(false);
      expect(response.status).toBe(413);
    }, 30000);

    test("should accept payloads under 10MB limit", async () => {
      // 1MB of tool output in history plus a message at the text length cap
      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [
            { type: "function_call", call_id: "c1", name: "lookup", arguments: "{}" },
            { type: "function_call_output", call_id: "c1", output: "A".repeat(1_000_000) },
            { role: "user", content: "A".repeat(100_000) },
          ],
          stream: true,
        }),
      });

      // Should accept and process
      expect(response.ok).toBe(true);
    }, 30000);
  });

  describe("Input Validation", () => {
    const post = (body: unknown) =>
      fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: false, ...(body as object) }),
      });

    test("should reject message text over the length cap", async () => {
      const response = await post({
        input: [{ role: "user", content: "A".repeat(100_001) }],
      });
      expect(response.status).toBe(400);
    }, 30000);

    test("should reject unknown input item types", async () => {
      const response = await post({
        input: [
          { type: "custom_item", payload: "x" },
          { role: "user", content: "hi" },
        ],
      });
      expect(response.status).toBe(400);
    }, 30000);

    test("should reject unknown roles", async () => {
      const response = await post({
        input: [{ role: "tool", content: "x" }, { role: "user", content: "hi" }],
      });
      expect(response.status).toBe(400);
    }, 30000);

    test("should reject too many input items", async () => {
      const response = await post({
        input: Array.from({ length: 501 }, () => ({ role: "user", content: "hi" })),
      });
      expect(response.status).toBe(400);
    }, 30000);

    test("should accept history with system, reasoning and approval items", async () => {
      const response = await post({
        input: [
          { role: "system", content: "Generate a short title" },
          { type: "reasoning", id: "r1", summary: [{ type: "summary_text", text: "thinking" }] },
          { type: "mcp_approval_request", id: "a1", name: "tool", arguments: "{}", server_label: "s" },
          { type: "mcp_approval_response", approval_request_id: "a1", approve: true },
          { role: "assistant", content: [{ type: "output_text", text: "ok" }] },
          { role: "user", content: [{ type: "input_text", text: "hi" }] },
        ],
      });
      expect(response.ok).toBe(true);
      const body = (await response.json()) as { output: unknown };
      expect(JSON.stringify(body.output)).toContain("Echo: hi");
    }, 30000);
  });

  describe("Origin and CORS", () => {
    test("should reject cross-site POSTs", async () => {
      for (const origin of ["https://evil.example", "null"]) {
        const response = await fetch(`${AGENT_URL}/invocations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify({ input: "hi", stream: false }),
        });
        expect(response.status).toBe(403);
      }
    }, 30000);

    test("should not send CORS headers to foreign origins", async () => {
      const response = await fetch(`${AGENT_URL}/health`, {
        headers: { Origin: "https://evil.example" },
      });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'"
      );
    }, 30000);
  });

  describe("Stream Robustness", () => {
    test("should handle complex requests without hanging", async () => {
      // Test with a complex request
      // Critical behavior: stream must complete (not hang)
      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [{
            role: "user",
            content: "Tell me about weather, time, and calculations"
          }],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      // Stream must complete - this is the critical behavior
      assertStreamComplete(text);
    }, 30000);
  });

});
