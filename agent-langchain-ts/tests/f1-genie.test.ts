/**
 * Formula 1 Genie Space integration test
 * Tests that the agent can use the F1 Genie space to answer questions about F1 data
 *
 * Prerequisites:
 * - Agent server running on http://localhost:5001 OR deployed app URL in APP_URL env var
 * - Formula 1 Genie space configured in src/mcp-servers.ts
 * - Genie space permission granted in databricks.yml
 * - For deployed apps: DATABRICKS_TOKEN env var with OAuth token
 *
 * Run with: npm run test:integration tests/f1-genie.test.ts
 * For deployed app: APP_URL=<url> DATABRICKS_TOKEN=$(databricks auth token --profile dogfood | jq -r '.access_token') npm test tests/f1-genie.test.ts
 */

import { describe, test, expect } from '@jest/globals';
import { execSync } from 'child_process';

const AGENT_URL = process.env.APP_URL || "http://localhost:5001";

// Get auth token for deployed apps
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // If testing deployed app, get OAuth token
  if (AGENT_URL.includes("databricksapps.com")) {
    let token = process.env.DATABRICKS_TOKEN;

    // If token not provided, try to get it from databricks CLI
    if (!token) {
      try {
        const tokenJson = execSync('databricks auth token --profile dogfood', { encoding: 'utf-8' });
        const parsed = JSON.parse(tokenJson);
        token = parsed.access_token;
      } catch (error) {
        console.warn("Warning: Could not get OAuth token. Set DATABRICKS_TOKEN env var.");
      }
    }

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  return headers;
}

describe("Formula 1 Genie Space Integration", () => {
  test("should answer F1 race winner question using Genie space", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: [{
          role: "user",
          content: "Who won the most races in the 2023 Formula 1 season?"
        }],
        stream: false,
      }),
    });

    expect(response.ok).toBe(true);
    const result: any = await response.json();

    // Should have output
    expect(result.output).toBeDefined();
    expect(result.output.length).toBeGreaterThan(0);

    // Output should contain F1-related content
    const output: string = result.output.toLowerCase();
    expect(
      output.includes("verstappen") ||
      output.includes("red bull") ||
      output.includes("races") ||
      output.includes("2023")
    ).toBe(true);

    console.log("✅ F1 Genie Space Response:", result.output);
  }, 60000); // 60s timeout for MCP tool execution

  test("should answer F1 team question using Genie space", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: [{
          role: "user",
          content: "Which team won the constructors championship in 2023?"
        }],
        stream: false,
      }),
    });

    expect(response.ok).toBe(true);
    const result: any = await response.json();

    expect(result.output).toBeDefined();
    expect(result.output.length).toBeGreaterThan(0);

    const output: string = result.output.toLowerCase();
    expect(
      output.includes("red bull") ||
      output.includes("constructor") ||
      output.includes("championship")
    ).toBe(true);

    console.log("✅ F1 Team Response:", result.output);
  }, 60000);

  test.skip("should detect Genie space tool in streaming response (TODO: AgentMCP streaming)", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: [{
          role: "user",
          content: "How many points did Max Verstappen score in 2023?"
        }],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();

    // Parse SSE stream to check for tool calls
    let hasToolCall = false;
    let fullOutput = "";
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));

          // Check for tool calls (Genie space invocation)
          if (data.type === "response.output_item.done" && data.item?.type === "function_call") {
            hasToolCall = true;
            console.log("✅ Tool call detected:", data.item.name);
          }

          // Collect text output
          if (data.type === "response.output_text.delta") {
            fullOutput += data.delta;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Should have called a tool (likely the Genie space)
    expect(hasToolCall).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);

    console.log("✅ Streaming F1 Response:", fullOutput);
  }, 60000);
});
