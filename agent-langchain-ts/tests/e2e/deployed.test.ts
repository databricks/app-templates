/**
 * Deployed app tests for Databricks Apps
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
    test("should respond with text", async () => {
      const response = await fetch(`${APP_URL}/invocations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: [{ role: "user", content: "Say hello" }],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      const text = await response.text();
      const { fullOutput } = parseSSEStream(text);

      expect(fullOutput.length).toBeGreaterThan(0);
      expect(text).toContain("data: [DONE]");
    }, 30000);
  });
});
