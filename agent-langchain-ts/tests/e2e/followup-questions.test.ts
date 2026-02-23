/**
 * Test for followup questions and multi-turn conversations
 * Debugs empty response issues in conversation context
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { getDeployedAuthToken, parseSSEStream, parseAISDKStream, makeAuthHeaders } from "../helpers.js";

const APP_URL = process.env.APP_URL || "https://agent-lc-ts-dev-6051921418418893.staging.aws.databricksapps.com";
let authToken: string;

beforeAll(async () => {
  console.log("🔑 Getting OAuth token...");
  authToken = await getDeployedAuthToken();
}, 30000);

const getAuthHeaders = () => makeAuthHeaders(authToken);

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
    const { fullOutput, events } = parseSSEStream(text);
    const eventTypes = events.map((e) => e.type);
    const hasTextDelta = eventTypes.some((t) => t === "response.output_text.delta");
    const hasStart = eventTypes.some((t) => t === "response.output_item.added");
    const hasFinish = eventTypes.some((t) => t === "response.output_item.done");

    console.log("\n=== Analysis ===");
    console.log("Events emitted:", [...new Set(eventTypes)]);
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

    const { fullOutput, events, toolCalls } = parseSSEStream(text);
    const eventTypes = events.map((e) => e.type);
    const hasTextDelta = eventTypes.some((t) => t === "response.output_text.delta");

    console.log("\n=== Analysis ===");
    console.log("Events emitted:", [...new Set(eventTypes)]);
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

    const { fullOutput, events } = parseSSEStream(text);
    const hasTextDelta = events.some((e) => e.type === "response.output_text.delta");

    console.log("\nFull output:", fullOutput);
    console.log("Has text delta:", hasTextDelta);
    console.log("Output length:", fullOutput.length);

    // Should provide SOME response (even if explaining no context)
    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);
  }, 60000);

  test("REGRESSION: should handle followup after tool call", async () => {
    console.log("\n=== Test: Followup After Tool Call (Regression) ===");
    console.log("This tests the fix for: tool call context being filtered out of chat history");

    // Simulate a conversation where:
    // 1. User asks for time in Tokyo
    // 2. Agent calls get_current_time tool
    // 3. User asks followup question referencing the tool result
    const response = await fetch(`${APP_URL}/invocations`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: [
          { role: "user", content: "What time is it in Tokyo?" },
          {
            role: "assistant",
            content: [
              {
                type: "function_call",
                name: "get_current_time",
                arguments: "{\"timezone\":\"Asia/Tokyo\"}"
              },
              {
                type: "function_call_output",
                output: "\"Current time in Asia/Tokyo: 10/02/2026, 9:30:00 PM\""
              },
              {
                type: "output_text",
                text: "The current time in Tokyo is 9:30 PM on February 10, 2026."
              }
            ]
          },
          { role: "user", content: "What time did you just tell me?" }
        ],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();

    console.log("\n=== Full SSE Response ===");
    console.log(text);
    console.log("...");

    // Parse SSE stream
    const { fullOutput, events } = parseSSEStream(text);
    const hasTextDelta = events.some((e) => e.type === "response.output_text.delta");

    console.log("\n=== Analysis ===");
    console.log("Has text delta:", hasTextDelta);
    console.log("Full output length:", fullOutput.length);
    console.log("\nFull output:", fullOutput);

    // ASSERTIONS
    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);

    // The response should reference the time that was mentioned
    // (agent should remember the tool call context)
    const lowerOutput = fullOutput.toLowerCase();
    const mentionedTime = lowerOutput.includes("9:30") ||
                         lowerOutput.includes("930") ||
                         lowerOutput.includes("tokyo");

    expect(mentionedTime).toBe(true);
    console.log("\n✅ Agent correctly remembered tool call context!");
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

    const { fullContent, hasTextDelta } = parseAISDKStream(text);

    console.log("\n=== Analysis ===");
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

    const { fullContent, hasTextDelta, hasToolCall } = parseAISDKStream(text);

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
