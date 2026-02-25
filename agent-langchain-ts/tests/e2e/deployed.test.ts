/**
 * Deployed app tests for Databricks Apps
 *
 * This file contains one example test to show developers how to test agent
 * tool calls against a deployed app. Copy and customize these tests to
 * verify your own tools and expected outputs.
 *
 * Prerequisites:
 * - App deployed to Databricks Apps
 * - Databricks CLI configured with OAuth
 * - APP_URL environment variable set
 *
 * Run with: APP_URL=<your-app-url> npm run test:deployed
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { getDeployedAuthToken, parseSSEStream } from "../helpers.js";

if (!process.env.APP_URL) {
  throw new Error("APP_URL environment variable is required to run deployed e2e tests");
}
const APP_URL = process.env.APP_URL;
let authToken: string;

beforeAll(async () => {
  console.log("🔑 Getting OAuth token...");
  authToken = await getDeployedAuthToken();
}, 30000);

describe("Deployed App Tests", () => {
  describe("/invocations endpoint", () => {
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
});
