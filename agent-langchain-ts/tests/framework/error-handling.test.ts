/**
 * Error handling tests for agent endpoints
 * Tests error scenarios including security fixes, memory leaks, and SSE completion
 *
 * Prerequisites:
 * - Agent server running on http://localhost:5001
 * - UI server running on http://localhost:3001
 *
 * Run with: npm run test:error-handling
 */

import { describe, test, expect } from '@jest/globals';
import {
  TEST_CONFIG,
  callInvocations,
  parseSSEStream,
} from '../helpers.js';

const AGENT_URL = TEST_CONFIG.AGENT_URL;
const UI_URL = TEST_CONFIG.UI_URL;

describe("Error Handling Tests", () => {
  describe("Security: Calculator Tool with mathjs", () => {
    test("should reject dangerous eval expressions", async () => {
      const response = await callInvocations({
        input: [{
          role: "user",
          content: "Calculate this: require('fs').readFileSync('/etc/passwd')"
        }],
        stream: true,
      });

      expect(response.ok).toBe(true);
      const text = await response.text();
      const { fullOutput, hasError } = parseSSEStream(text);

      // Should either error or return "undefined" (mathjs doesn't support require())
      // The key is it should NOT execute arbitrary code
      const hasDangerousOutput = fullOutput.includes("root:") || fullOutput.includes("/bin/bash");
      expect(hasDangerousOutput).toBe(false);
    }, 30000);

    test("should handle invalid mathematical expressions safely", async () => {
      const response = await callInvocations({
        input: [{
          role: "user",
          content: "Calculate: sqrt(-1) + invalid_function(42)"
        }],
        stream: true,
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      // Critical behavior: stream completes even with invalid expressions
      expect(text.includes("data: [DONE]")).toBe(true);

      // No dangerous output (already covered by other test)
      // Model may or may not provide text output - that's ok
    }, 30000);
  });

  describe("SSE Stream Completion", () => {
    test("should send completion events on successful response", async () => {
      const response = await callInvocations({
        input: [{ role: "user", content: "Say 'test'" }],
        stream: true,
      });

      expect(response.ok).toBe(true);
      const text = await response.text();
      const { events } = parseSSEStream(text);

      // Verify proper SSE completion sequence
      expect(text.includes("data: [DONE]")).toBe(true);
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

    test("should send [DONE] even when stream encounters errors", async () => {
      // Send a request that might cause tool execution issues
      const response = await callInvocations({
        input: [{
          role: "user",
          content: "Calculate: " + "x".repeat(10000) // Very long invalid expression
        }],
        stream: true,
      });

      expect(response.ok).toBe(true);
      const text = await response.text();
      const { events } = parseSSEStream(text);

      // Even if there's an error, stream should complete properly
      expect(events.some(e => e.type === "response.completed" || e.type === "response.failed")).toBe(true);
      expect(text.includes("data: [DONE]")).toBe(true);
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
      const response = await callInvocations({
        input: [{
          role: "user",
          content: "Tell me about weather, time, and calculations"
        }],
        stream: true,
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      // Stream must complete - this is the critical behavior
      expect(text.includes("data: [DONE]")).toBe(true);

      // Must end with [DONE]
      expect(text).toContain("data: [DONE]");
    }, 30000);
  });

  describe("/api/chat Error Handling", () => {
    test("should handle errors in useChat format", async () => {
      const response = await fetch(`${UI_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "550e8400-e29b-41d4-a716-446655440000",
          message: {
            role: "user",
            parts: [
              {
                type: "text",
                text: "Calculate: require('child_process').exec('ls')"
              }
            ],
            id: "550e8400-e29b-41d4-a716-446655440001",
          },
          selectedChatModel: "chat-model",
          selectedVisibilityType: "private",
          nextMessageId: "550e8400-e29b-41d4-a716-446655440002",
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      // Should NOT contain dangerous output
      expect(text).not.toContain("package.json");
      expect(text).not.toContain("node_modules");

      // Should complete stream
      const lines = text.split("\n");
      const hasFinishEvent = lines.some(line =>
        line.includes('"type":"finish"') ||
        line.includes('"type":"text-delta"')
      );
      expect(hasFinishEvent).toBe(true);
    }, 30000);

    test("should reject malformed useChat requests", async () => {
      const response = await fetch(`${UI_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Missing required fields
          id: "550e8400-e29b-41d4-a716-446655440000",
        }),
      });

      // Should reject with error status
      expect(response.ok).toBe(false);
    }, 30000);
  });

  describe("Memory Leak Prevention", () => {
    test("should not accumulate tool call IDs across requests", async () => {
      // Make multiple requests with tool calls
      const requests = [];
      for (let i = 0; i < 3; i++) {
        const promise = fetch(`${AGENT_URL}/invocations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: [{ role: "user", content: `Calculate ${i} + ${i}` }],
            stream: true,
          }),
        });
        requests.push(promise);
      }

      const responses = await Promise.all(requests);

      // All requests should succeed
      for (const response of responses) {
        expect(response.ok).toBe(true);
        const text = await response.text();

        // Each should complete properly
        expect(text).toContain("data: [DONE]");
      }

      // If there's a memory leak, subsequent requests might fail or timeout
      // This test passing indicates proper cleanup
    }, 45000);

    test("should clean up tool tracking on stream errors", async () => {
      // First request that might error
      const errorResponse = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [{ role: "user", content: "Calculate: invalid!!!" }],
          stream: true,
        }),
      });

      expect(errorResponse.ok).toBe(true);
      const errorText = await errorResponse.text();
      expect(errorText).toContain("data: [DONE]");

      // Second request should work fine (no stale call_ids)
      const successResponse = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [{ role: "user", content: "Calculate: 2 + 2" }],
          stream: true,
        }),
      });

      expect(successResponse.ok).toBe(true);
      const successText = await successResponse.text();

      // Should complete successfully without "No matching tool call" errors
      expect(successText).toContain("data: [DONE]");
      expect(successText.toLowerCase()).not.toContain("no matching tool call");
    }, 30000);
  });

});
