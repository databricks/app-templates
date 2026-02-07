/**
 * Integration tests for local agent endpoints
 * Tests both /invocations and /api/chat with tool calling
 *
 * Prerequisites:
 * - Agent server running on http://localhost:5001
 * - UI server running on http://localhost:3001
 *
 * Run with: npm test tests/integration.test.ts
 */

import { describe, test, expect } from '@jest/globals';
import { createDatabricksProvider } from "@databricks/ai-sdk-provider";
import { streamText } from "ai";

const AGENT_URL = "http://localhost:5001";
const UI_URL = "http://localhost:3001";

describe("Integration Tests - Local Endpoints", () => {
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
            if (data.type === "response.output_item.done" && data.item?.type === "function_call") {
              hasToolCall = true;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

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
            parts: [{ type: "text", text: "Say exactly: useChat test successful" }],
            id: "550e8400-e29b-41d4-a716-446655440001",
          },
          selectedChatModel: "chat-model",
          selectedVisibilityType: "private",
          nextMessageId: "550e8400-e29b-41d4-a716-446655440002",
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      // Parse text deltas
      const lines = text.split("\n");
      let fullContent = "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "text-delta") {
              fullContent += data.delta;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      expect(text).toContain('"type":"text-delta"');
      expect(fullContent.toLowerCase()).toContain("usechat");
      expect(fullContent.toLowerCase()).toContain("successful");
    }, 30000);

    test("should handle tool calling without errors", async () => {
      const response = await fetch(`${UI_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "550e8400-e29b-41d4-a716-446655440000",
          message: {
            role: "user",
            parts: [{ type: "text", text: "time in tokyo?" }],
            id: "550e8400-e29b-41d4-a716-446655440001",
          },
          selectedChatModel: "chat-model",
          selectedVisibilityType: "private",
          nextMessageId: "550e8400-e29b-41d4-a716-446655440002",
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      const hasToolInput = text.includes('"type":"tool-input-available"');
      const hasToolOutput = text.includes('"type":"tool-output-available"');
      const hasError = text.includes('"type":"error"');

      expect(hasToolInput).toBe(true);
      expect(hasToolOutput).toBe(true);
      expect(hasError).toBe(false);
    }, 30000);
  });
});
