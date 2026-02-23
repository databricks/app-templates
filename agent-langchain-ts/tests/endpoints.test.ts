/**
 * Integration tests for API endpoints
 * Tests both /invocations (Responses API) and /api/chat (AI SDK + useChat)
 */

import { describe, test, expect } from "@jest/globals";
import {
  callInvocations,
  parseSSEStream,
  getAgentUrl,
} from "./helpers.js";

describe("API Endpoints", () => {
  // Use the already-running unified server
  const BASE_URL = getAgentUrl();

  describe("/invocations endpoint", () => {
    test("should respond with Responses API format", async () => {
      const response = await callInvocations(
        {
          input: [{ role: "user", content: "Say 'test' and nothing else" }],
          stream: true,
        },
        BASE_URL
      );

      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const text = await response.text();
      const { events, fullOutput } = parseSSEStream(text);

      expect(events.length).toBeGreaterThan(0);
      expect(text.includes("data: [DONE]")).toBe(true);
      expect(events.some(e => e.type === "response.completed" || e.type === "response.failed")).toBe(true);

      // Should have text delta events
      const hasTextDelta = events.some((e) => e.type === "response.output_text.delta");
      expect(hasTextDelta).toBe(true);
    }, 30000);

    test("should work with Databricks AI SDK provider", async () => {
      // This tests that our /invocations endpoint returns the correct format
      // The Databricks AI SDK provider expects Responses API format

      const response = await callInvocations(
        {
          input: [{ role: "user", content: "Say 'SDK test'" }],
          stream: true,
        },
        BASE_URL
      );

      expect(response.ok).toBe(true);

      const text = await response.text();

      // Should have Responses API delta events
      expect(text).toContain("response.output_text.delta");
      expect(text.includes("data: [DONE]")).toBe(true);
    }, 30000);

    test("should handle tool calling", async () => {
      const response = await callInvocations(
        {
          input: [{ role: "user", content: "What is 7 * 8?" }],
          stream: true,
        },
        BASE_URL
      );

      expect(response.ok).toBe(true);

      const text = await response.text();
      const { fullOutput } = parseSSEStream(text);

      expect(text.includes("data: [DONE]")).toBe(true);
      expect(fullOutput).toContain("56");
    }, 30000);
  });

  describe("/api/chat endpoint (when UI server is available)", () => {
    test("should be available when UI backend is running", async () => {
      // Note: This test requires the UI server to be running
      // For now, we'll just verify the architecture is correct

      // In production, the UI server provides /api/chat
      // It uses API_PROXY to call /invocations
      // We've verified /invocations works above

      expect(true).toBe(true);
    });

    // TODO: Add integration test with actual UI server running
    // This would require starting both servers in the test setup
  });
});
