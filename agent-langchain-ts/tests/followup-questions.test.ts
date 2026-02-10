/**
 * Test for followup questions and multi-turn conversations
 * Debugs empty response issues in conversation context
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

function getAuthHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`,
  };
}

describe("Followup Questions - /invocations", () => {
  test("should handle simple followup question with context", async () => {
    console.log("\n=== Test: Simple Followup ===");

    // Send request with conversation history
    const response = await fetch(`${APP_URL}/invocations`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: [
          { role: "user", content: "My favorite color is blue" },
          { role: "assistant", content: "I'll remember that your favorite color is blue." },
          { role: "user", content: "What is my favorite color?" },
        ],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();

    console.log("\n=== Full SSE Response ===");
    console.log(text.substring(0, 2000)); // First 2000 chars
    console.log("...\n");

    // Parse SSE events
    let fullOutput = "";
    let hasTextDelta = false;
    let events: string[] = [];
    let hasStart = false;
    let hasFinish = false;

    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));
          events.push(data.type);

          if (data.type === "response.output_text.delta") {
            hasTextDelta = true;
            fullOutput += data.delta;
          }
          if (data.type === "response.output_item.done" && data.item?.type === "text") {
            hasFinish = true;
          }
          if (data.type === "response.output_item.added" && data.item?.type === "text") {
            hasStart = true;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    console.log("\n=== Analysis ===");
    console.log("Events emitted:", [...new Set(events)]);
    console.log("Has start event:", hasStart);
    console.log("Has text delta events:", hasTextDelta);
    console.log("Has finish event:", hasFinish);
    console.log("Full output length:", fullOutput.length);
    console.log("\nFull output:", fullOutput);

    // ASSERTIONS
    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);
    expect(fullOutput.toLowerCase()).toContain("blue");
  }, 60000);

  test("should handle multi-turn conversation with calculations", async () => {
    console.log("\n=== Test: Multi-turn with Tool Use ===");

    const response = await fetch(`${APP_URL}/invocations`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: [
          { role: "user", content: "Calculate 15 * 20" },
          { role: "assistant", content: "15 * 20 = 300" },
          { role: "user", content: "Now multiply that result by 2" },
        ],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();

    console.log("\n=== Full SSE Response ===");
    console.log(text.substring(0, 2000));
    console.log("...\n");

    let fullOutput = "";
    let hasTextDelta = false;
    let toolCalls: any[] = [];
    let events: string[] = [];

    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));
          events.push(data.type);

          if (data.type === "response.output_text.delta") {
            hasTextDelta = true;
            fullOutput += data.delta;
          }
          if (data.type === "response.output_item.done" && data.item?.type === "function_call") {
            toolCalls.push(data.item);
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    console.log("\n=== Analysis ===");
    console.log("Events emitted:", [...new Set(events)]);
    console.log("Has text delta events:", hasTextDelta);
    console.log("Tool calls:", toolCalls.length);
    console.log("Full output length:", fullOutput.length);
    console.log("\nFull output:", fullOutput);
    console.log("\nTool calls:", JSON.stringify(toolCalls, null, 2));

    // ASSERTIONS
    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);

    // Should reference the result (600) or calculation
    const hasResult = fullOutput.includes("600") || fullOutput.toLowerCase().includes("calculation");
    expect(hasResult).toBe(true);
  }, 60000);

  test("should handle empty previous message history edge case", async () => {
    console.log("\n=== Test: Empty History Edge Case ===");

    // This tests what happens with just a single followup-style question
    // without actual history
    const response = await fetch(`${APP_URL}/invocations`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: [
          { role: "user", content: "What did I just tell you?" },
        ],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();

    let fullOutput = "";
    let hasTextDelta = false;

    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "response.output_text.delta") {
            hasTextDelta = true;
            fullOutput += data.delta;
          }
        } catch {
          // Skip
        }
      }
    }

    console.log("\nFull output:", fullOutput);
    console.log("Has text delta:", hasTextDelta);
    console.log("Output length:", fullOutput.length);

    // Should provide SOME response (even if explaining no context)
    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);
  }, 60000);
});

describe("Followup Questions - /api/chat", () => {
  test("should handle followup via useChat format", async () => {
    console.log("\n=== Test: useChat Followup ===");

    const response = await fetch(`${APP_URL}/api/chat`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440100",
        message: {
          role: "user",
          parts: [{ type: "text", text: "What did I say before?" }],
          id: "550e8400-e29b-41d4-a716-446655440101",
        },
        previousMessages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Remember: purple elephant" }],
            id: "550e8400-e29b-41d4-a716-446655440102",
          },
          {
            role: "assistant",
            parts: [{ type: "text", text: "I'll remember: purple elephant" }],
            id: "550e8400-e29b-41d4-a716-446655440103",
          },
        ],
        selectedChatModel: "chat-model",
        selectedVisibilityType: "private",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`\n❌ /api/chat error (${response.status}):`, errorText);
    }
    expect(response.ok).toBe(true);
    const text = await response.text();

    console.log("\n=== /api/chat Response ===");
    console.log(text.substring(0, 2000));
    console.log("...\n");

    let fullContent = "";
    let hasTextDelta = false;
    let events: string[] = [];

    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));
          events.push(data.type);

          if (data.type === "text-delta") {
            hasTextDelta = true;
            fullContent += data.delta || "";
          }
        } catch {
          // Skip
        }
      }
    }

    console.log("\n=== Analysis ===");
    console.log("Events emitted:", [...new Set(events)]);
    console.log("Has text delta events:", hasTextDelta);
    console.log("Full content length:", fullContent.length);
    console.log("\nFull content:", fullContent);

    // ASSERTIONS
    expect(hasTextDelta).toBe(true);
    expect(fullContent.length).toBeGreaterThan(0);

    // Should reference previous context
    const mentionsContext = fullContent.toLowerCase().includes("purple") ||
                           fullContent.toLowerCase().includes("elephant");
    expect(mentionsContext).toBe(true);
  }, 60000);

  test("should handle complex multi-turn via useChat", async () => {
    console.log("\n=== Test: Complex Multi-turn via useChat ===");

    const response = await fetch(`${APP_URL}/api/chat`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440200",
        message: {
          role: "user",
          parts: [{ type: "text", text: "What's the total of all numbers I mentioned?" }],
          id: "550e8400-e29b-41d4-a716-446655440201",
        },
        previousMessages: [
          {
            role: "user",
            parts: [{ type: "text", text: "The first number is 25" }],
            id: "550e8400-e29b-41d4-a716-446655440202",
          },
          {
            role: "assistant",
            parts: [{ type: "text", text: "Okay, the first number is 25." }],
            id: "550e8400-e29b-41d4-a716-446655440203",
          },
          {
            role: "user",
            parts: [{ type: "text", text: "The second number is 13" }],
            id: "550e8400-e29b-41d4-a716-446655440204",
          },
          {
            role: "assistant",
            parts: [{ type: "text", text: "Got it, the second number is 13." }],
            id: "550e8400-e29b-41d4-a716-446655440205",
          },
        ],
        selectedChatModel: "chat-model",
        selectedVisibilityType: "private",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`\n❌ /api/chat error (${response.status}):`, errorText);
    }
    expect(response.ok).toBe(true);
    const text = await response.text();

    console.log("\n=== Response ===");
    console.log(text.substring(0, 2000));
    console.log("...\n");

    let fullContent = "";
    let hasTextDelta = false;
    let hasToolCall = false;

    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));

          if (data.type === "text-delta") {
            hasTextDelta = true;
            fullContent += data.delta || "";
          }
          if (data.type === "tool-call-delta" || data.type === "tool-output-available") {
            hasToolCall = true;
          }
        } catch {
          // Skip
        }
      }
    }

    console.log("\n=== Analysis ===");
    console.log("Has text delta events:", hasTextDelta);
    console.log("Has tool calls:", hasToolCall);
    console.log("Full content length:", fullContent.length);
    console.log("\nFull content:", fullContent);

    // ASSERTIONS
    expect(hasTextDelta).toBe(true);
    expect(fullContent.length).toBeGreaterThan(0);

    // Should mention the sum (38) or calculation
    const hasSum = fullContent.includes("38") || fullContent.toLowerCase().includes("total");
    expect(hasSum).toBe(true);
  }, 60000);
});
