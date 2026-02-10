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
  assertSSECompleted,
  assertSSEHasCompletionEvent,
} from './helpers.js';

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
      const { fullOutput } = parseSSEStream(text);

      // Should complete the stream even if calculator fails
      expect(assertSSECompleted(text)).toBe(true);

      // Should mention error or inability to calculate
      const lowerOutput = fullOutput.toLowerCase();
      const hasReasonableResponse =
        lowerOutput.includes("error") ||
        lowerOutput.includes("invalid") ||
        lowerOutput.includes("undefined") ||
        lowerOutput.includes("cannot");

      expect(hasReasonableResponse).toBe(true);
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
      expect(assertSSECompleted(text)).toBe(true);
      expect(assertSSEHasCompletionEvent(events)).toBe(true);

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
      expect(assertSSEHasCompletionEvent(events)).toBe(true);
      expect(assertSSECompleted(text)).toBe(true);
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

  describe("Tool Execution Error Recovery", () => {
    test("should recover from tool execution failures", async () => {
      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [
            {
              role: "user",
              content: "Get the weather in InvalidCityName123456"
            }
          ],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      // Parse SSE stream
      let fullOutput = "";
      let hasToolCall = false;
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "response.output_text.delta") {
              fullOutput += data.delta;
            }
            if (data.type === "response.output_item.done" &&
                data.item?.type === "function_call" &&
                data.item?.name === "get_weather") {
              hasToolCall = true;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      // Should attempt the tool call
      expect(hasToolCall).toBe(true);

      // Should complete the stream even if tool fails
      expect(text).toContain("data: [DONE]");

      // Should provide some response (might be error message or fallback)
      expect(fullOutput.length).toBeGreaterThan(0);
    }, 30000);

    test("should handle multiple tool failures in sequence", async () => {
      const response = await fetch(`${AGENT_URL}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [
            {
              role: "user",
              content: "Calculate 1/0 and then get weather in InvalidCity"
            }
          ],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      // Should complete stream despite multiple errors
      expect(text).toContain("data: [DONE]");

      // Should have completion event
      const hasCompletion =
        text.includes('"type":"response.completed"') ||
        text.includes('"type":"response.failed"');
      expect(hasCompletion).toBe(true);
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

  describe("Tool Permission Errors", () => {
    function getAuthHeaders(): Record<string, string> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      const deployedUrl = process.env.APP_URL;
      if (deployedUrl && deployedUrl.includes("databricksapps.com")) {
        let token = process.env.DATABRICKS_TOKEN;
        if (!token) {
          try {
            const { execSync } = require('child_process');
            const tokenJson = execSync('databricks auth token --profile dogfood', { encoding: 'utf-8' });
            const parsed = JSON.parse(tokenJson);
            token = parsed.access_token;
          } catch (error) {
            console.warn("Warning: Could not get OAuth token.");
          }
        }
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      }

      return headers;
    }

    test("agent should respond when tool returns permission error", async () => {
      const testUrl = process.env.APP_URL || AGENT_URL;
      const response = await fetch(`${testUrl}/invocations`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          input: [{
            role: "user",
            content: "Tell me about F1 race data and answer an example question about it"
          }],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      // Parse SSE stream
      let fullOutput = "";
      let hasTextDelta = false;
      let toolCalls: any[] = [];
      let toolErrors: any[] = [];

      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "response.output_text.delta") {
              hasTextDelta = true;
              fullOutput += data.delta;
            }

            if (data.type === "response.output_item.done" && data.item?.type === "function_call") {
              toolCalls.push(data.item);
            }

            if (data.type === "response.output_item.done" && data.item?.type === "function_call_output") {
              const output = data.item.output;
              if (output && (output.includes("Error") || output.includes("permission"))) {
                toolErrors.push({ call_id: data.item.call_id, output });
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      // EXPECTED BEHAVIOR: Even with tool errors, agent should provide a text response
      expect(hasTextDelta).toBe(true);
      expect(fullOutput.length).toBeGreaterThan(0);
    }, 60000);

    test("agent should handle tool error in /api/chat", async () => {
      const testUrl = process.env.APP_URL || AGENT_URL;
      // Note: /api/chat might not be available on all deployments
      // This test is primarily for local development

      const response = await fetch(`${testUrl}/api/chat`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          id: "550e8400-e29b-41d4-a716-446655440000",
          message: {
            role: "user",
            parts: [{
              type: "text",
              text: "What Formula 1 race had the most overtakes in 2023?"
            }],
            id: "550e8400-e29b-41d4-a716-446655440001",
          },
          selectedChatModel: "chat-model",
          selectedVisibilityType: "private",
        }),
      });

      if (!response.ok) {
        // /api/chat might not be available on deployed apps
        console.log("⏭️  Skipping /api/chat test (endpoint not available)");
        return;
      }

      const text = await response.text();

      // Parse events
      let fullContent = "";
      let hasTextDelta = false;

      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "text-delta") {
              hasTextDelta = true;
              fullContent += data.delta || "";
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      // Agent should provide text response
      expect(hasTextDelta).toBe(true);
      expect(fullContent.length).toBeGreaterThan(0);

      // Check if the agent mentioned querying or Formula 1
      const lowerContent = fullContent.toLowerCase();
      const mentionsQuery = lowerContent.includes("query") ||
                           lowerContent.includes("formula") ||
                           lowerContent.includes("race") ||
                           lowerContent.includes("f1");

      expect(mentionsQuery).toBe(true);
    }, 60000);
  });
});
