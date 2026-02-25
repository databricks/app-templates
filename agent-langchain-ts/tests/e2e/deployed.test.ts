/**
 * Deployed app tests for Databricks Apps
 * Tests production deployment including UI, APIs, and tool calling
 *
 * Prerequisites:
 * - App deployed to Databricks Apps
 * - Databricks CLI configured with OAuth
 * - APP_URL environment variable set (or uses default)
 *
 * Run with: npm test tests/deployed.test.ts
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { getDeployedAuthToken, parseSSEStream, parseAISDKStream } from "../helpers.js";

const APP_URL = process.env.APP_URL || "https://agent-lc-ts-dev-6051921418418893.staging.aws.databricksapps.com";
let authToken: string;

beforeAll(async () => {
  console.log("🔑 Getting OAuth token...");
  authToken = await getDeployedAuthToken();
}, 30000);

describe("Deployed App Tests", () => {
  describe("UI Root", () => {
    test("should serve HTML at /", async () => {
      const response = await fetch(`${APP_URL}/`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.ok).toBe(true);
      const html = await response.text();
      expect(html).toMatch(/<!DOCTYPE html>|<html/);
      expect(html).toContain("<title>");
    }, 30000);
  });

  describe("/invocations endpoint", () => {
    test("should respond correctly", async () => {
      const response = await fetch(`${APP_URL}/invocations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: [
            {
              role: "user",
              content: "Say exactly: Deployed invocations test successful",
            },
          ],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      const { fullOutput } = parseSSEStream(text);

      expect(fullOutput.toLowerCase()).toContain("deployed");
      expect(fullOutput.toLowerCase()).toContain("successful");
    }, 30000);

    test("should handle calculator tool", async () => {
      const response = await fetch(`${APP_URL}/invocations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: [
            {
              role: "user",
              content: "Calculate 123 * 456 using the calculator tool",
            },
          ],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      const { fullOutput, toolCalls } = parseSSEStream(text);

      // Assert for tool call in message history
      const hasCalculatorCall = toolCalls.some((call) => call.name === "calculator");
      expect(hasCalculatorCall).toBe(true);

      // Verify result in output
      const hasResult = fullOutput.includes("56088") || fullOutput.includes("56,088");
      expect(hasResult).toBe(true);
    }, 30000);
  });

  describe("/api/chat endpoint", () => {
    test("should respond correctly", async () => {
      const response = await fetch(`${APP_URL}/api/chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "550e8400-e29b-41d4-a716-446655440000",
          message: {
            role: "user",
            parts: [
              {
                type: "text",
                text: "Say exactly: Deployed useChat test successful",
              },
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

      const { fullContent } = parseAISDKStream(text);

      expect(fullContent.toLowerCase()).toContain("deployed");
      expect(fullContent.toLowerCase()).toContain("successful");
    }, 30000);
  });
});
