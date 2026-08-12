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

import { describe, test, expect, beforeAll } from "@jest/globals";
import { createAuthProvider, MlflowClient, type Trace } from "@mlflow/core";
import { getDeployedAuthToken, parseSSEStream } from "../helpers.js";

const APP_URL = process.env.APP_URL;
const deployedDescribe = APP_URL ? describe : describe.skip;
let authToken: string;

beforeAll(async () => {
  console.log("🔑 Getting OAuth token...");
  authToken = await getDeployedAuthToken();
}, 30000);

async function retrieveTrace(traceId: string): Promise<Trace> {
  const profile = process.env.DATABRICKS_CLI_PROFILE;
  const trackingUri = profile ? `databricks://${profile}` : "databricks";
  const client = new MlflowClient({
    trackingUri,
    authProvider: createAuthProvider({ trackingUri }),
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await client.getTrace(traceId);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw lastError;
}

deployedDescribe("Deployed App Tests", () => {
  describe("/invocations endpoint", () => {
    test("should respond with text", async () => {
      const response = await fetch(`${APP_URL!}/invocations`, {
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
      const traceId = response.headers.get("x-mlflow-trace-id");
      expect(traceId).toMatch(/^trace:\/[^/]+\/[0-9a-f]{32}$/);
      const text = await response.text();
      const { fullOutput } = parseSSEStream(text);

      expect(fullOutput.length).toBeGreaterThan(0);
      expect(text).toContain("data: [DONE]");
      const trace = await retrieveTrace(traceId!);
      expect(trace.info.traceId).toBe(traceId);
      const roots = trace.data.spans.filter((span) => span.parentId === null);
      expect(roots).toHaveLength(1);
      expect(roots[0].spanType).toBe("AGENT");
      expect(roots[0].inputs).toBeDefined();
      expect(roots[0].outputs).toBeDefined();
    }, 90000);
  });
});
