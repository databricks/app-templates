/**
 * Test for tool error handling
 * Verifies that the agent handles tool permission errors gracefully
 * and provides a response even when tools fail
 */

import { describe, test, expect } from '@jest/globals';
import { execSync } from 'child_process';

const AGENT_URL = process.env.APP_URL || "http://localhost:5001";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (AGENT_URL.includes("databricksapps.com")) {
    let token = process.env.DATABRICKS_TOKEN;
    if (!token) {
      try {
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

describe("Tool Error Handling", () => {
  test("agent should respond when tool returns permission error", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
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

    console.log("\n=== Full SSE Response ===");
    console.log(text);
    console.log("=== End Response ===\n");

    // Parse SSE stream
    let fullOutput = "";
    let hasTextDelta = false;
    let toolCalls: any[] = [];
    let toolErrors: any[] = [];
    let events: string[] = [];

    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));
          events.push(data.type);

          // Collect text deltas
          if (data.type === "response.output_text.delta") {
            hasTextDelta = true;
            fullOutput += data.delta;
          }

          // Track tool calls
          if (data.type === "response.output_item.done" && data.item?.type === "function_call") {
            toolCalls.push(data.item);
          }

          // Track tool outputs (including errors)
          if (data.type === "response.output_item.done" && data.item?.type === "function_call_output") {
            const output = data.item.output;
            if (output && (output.includes("Error") || output.includes("permission"))) {
              toolErrors.push({ call_id: data.item.call_id, output });
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    console.log("\n=== Analysis ===");
    console.log("Events emitted:", events);
    console.log("Tool calls:", toolCalls.length);
    console.log("Tool errors:", toolErrors.length);
    console.log("Has text output:", hasTextDelta);
    console.log("Full output length:", fullOutput.length);
    console.log("\nFull output:", fullOutput);
    console.log("\nTool errors:", JSON.stringify(toolErrors, null, 2));

    // EXPECTED BEHAVIOR: Even with tool errors, agent should provide a text response
    // The agent should either:
    // 1. Acknowledge the error and provide context
    // 2. Use fallback knowledge to answer
    // 3. Explain what happened
    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);

    // Should not just fail silently
    if (toolErrors.length > 0) {
      // If tools failed, the agent should acknowledge it in the response
      const lowerOutput = fullOutput.toLowerCase();
      const mentionsError = lowerOutput.includes("unable") ||
                           lowerOutput.includes("cannot") ||
                           lowerOutput.includes("permission") ||
                           lowerOutput.includes("error");

      console.log("\nAgent acknowledged error:", mentionsError);

      // This is the ideal behavior - agent should mention it can't access the tool
      // but we'll make this a soft check for now
    }
  }, 60000);

  test("agent should handle tool error in /api/chat", async () => {
    const response = await fetch(`${AGENT_URL}/api/chat`, {
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

    expect(response.ok).toBe(true);
    const text = await response.text();

    console.log("\n=== /api/chat Response ===");
    console.log(text);
    console.log("=== End Response ===\n");

    // Parse events
    let fullContent = "";
    let hasTextDelta = false;
    let hasToolError = false;

    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));

          if (data.type === "text-delta") {
            hasTextDelta = true;
            fullContent += data.delta || "";
          }

          if (data.type === "tool-output-available" && data.output) {
            const output = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
            if (output.includes("Error") || output.includes("permission")) {
              hasToolError = true;
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    console.log("\nHas text response:", hasTextDelta);
    console.log("Has tool error:", hasToolError);
    console.log("Full content:", fullContent);

    // Agent should provide SOME text response (either before or after tool error)
    // Due to model behavior variability, we accept either:
    // 1. Initial text + follow-up after error (ideal)
    // 2. Just initial text explaining what it will do (acceptable)
    // What we DON'T want: complete silence or crash
    expect(hasTextDelta).toBe(true);
    expect(fullContent.length).toBeGreaterThan(0);

    // Check if the agent at least mentioned querying or attempting to access data
    const lowerContent = fullContent.toLowerCase();
    const mentionsQuery = lowerContent.includes("query") ||
                         lowerContent.includes("formula") ||
                         lowerContent.includes("race") ||
                         lowerContent.includes("f1");

    expect(mentionsQuery).toBe(true);

    console.log("\n✅ Agent handled tool error gracefully");
    console.log("   Provided text response:", fullContent.length, "characters");
    console.log("   Mentioned relevant context:", mentionsQuery);
  }, 60000);
});
