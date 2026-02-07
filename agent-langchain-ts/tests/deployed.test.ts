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
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const APP_URL = process.env.APP_URL || "https://agent-lc-ts-dev-6051921418418893.staging.aws.databricksapps.com";
let authToken: string;

beforeAll(async () => {
  console.log("🔑 Getting OAuth token...");
  try {
    const { stdout } = await execAsync("databricks auth token --profile dogfood");
    const tokenData = JSON.parse(stdout.trim());
    authToken = tokenData.access_token;
  } catch (error) {
    throw new Error(`Failed to get auth token: ${error}`);
  }
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

      let fullOutput = "";
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "response.output_text.delta") {
              fullOutput += data.delta;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

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
              content: "Calculate 123 * 456",
            },
          ],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

      let fullOutput = "";
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "response.output_text.delta") {
              fullOutput += data.delta;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      const hasResult = fullOutput.includes("56088") || fullOutput.includes("56,088");
      expect(hasResult).toBe(true);
    }, 30000);

    test("should handle time tool", async () => {
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
              content: "What time is it in Tokyo?",
            },
          ],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();

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
                data.item?.name === "get_current_time") {
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

      let fullContent = "";
      const lines = text.split("\n");
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

      expect(fullContent.toLowerCase()).toContain("deployed");
      expect(fullContent.toLowerCase()).toContain("successful");
    }, 30000);
  });
});
