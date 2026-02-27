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
      // Create a payload just under 10MB
      const acceptableMessage = "A".repeat(1024 * 1024); // 1MB

      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [
            { role: "user", content: acceptableMessage }
          ],
          stream: true,
        }),
      });

      // Should accept and process
      expect(response.ok).toBe(true);
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
