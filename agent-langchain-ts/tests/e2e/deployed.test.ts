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
import { WorkspaceClient } from "@databricks/sdk-experimental";
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

async function queryOtelSpans(traceId: string): Promise<string[][]> {
  const warehouseId = process.env.MLFLOW_TRACING_SQL_WAREHOUSE_ID;
  const otelSpansTable = process.env.MLFLOW_OTEL_SPANS_TABLE;
  if (!warehouseId || !otelSpansTable) {
    throw new Error(
      "MLFLOW_TRACING_SQL_WAREHOUSE_ID and MLFLOW_OTEL_SPANS_TABLE are required",
    );
  }

  const profile = process.env.DATABRICKS_CLI_PROFILE;
  const client = new WorkspaceClient({ profile });
  const storedTraceId = traceId.slice(traceId.lastIndexOf("/") + 1).toLowerCase();
  let lastState: string | undefined;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    let statement = await client.statementExecution.executeStatement({
      warehouse_id: warehouseId,
      statement:
        "SELECT trace_id, span_id FROM IDENTIFIER(:otel_spans_table) " +
        "WHERE trace_id = :trace_id ORDER BY start_time_unix_nano",
      parameters: [
        { name: "otel_spans_table", type: "STRING", value: otelSpansTable },
        { name: "trace_id", type: "STRING", value: storedTraceId },
      ],
      wait_timeout: "10s",
      on_wait_timeout: "CONTINUE",
    });

    for (let poll = 0; poll < 12; poll += 1) {
      lastState = statement.status?.state;
      if (lastState !== "PENDING" && lastState !== "RUNNING") break;
      if (!statement.statement_id) {
        throw new Error("SQL statement is pending without a statement ID");
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      statement = await client.statementExecution.getStatement({
        statement_id: statement.statement_id,
      });
    }

    if (statement.status?.state === "FAILED") {
      throw new Error(`UC trace query failed: ${statement.status.error?.message}`);
    }
    const rows = statement.result?.data_array ?? [];
    if (rows.some((row) => row[0]?.toLowerCase() === storedTraceId)) {
      return rows as string[][];
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(
    `UC spans table ${otelSpansTable} has no rows for returned trace ${traceId}; last SQL state: ${lastState}`,
  );
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
      const persistedRows = await queryOtelSpans(traceId!);
      expect(persistedRows.length).toBeGreaterThan(0);
    }, 180000);
  });
});
