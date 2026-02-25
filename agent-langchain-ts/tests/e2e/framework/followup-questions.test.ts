/**
 * Test for followup questions and multi-turn conversations
 * Debugs empty response issues in conversation context
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { getDeployedAuthToken, parseSSEStream, parseAISDKStream, makeAuthHeaders } from "../../helpers.js";

if (!process.env.APP_URL) {
  throw new Error("APP_URL environment variable is required to run deployed e2e tests");
}
const APP_URL = process.env.APP_URL;
let authToken: string;

beforeAll(async () => {
  authToken = await getDeployedAuthToken();
}, 30000);

const getAuthHeaders = () => makeAuthHeaders(authToken);

describe("Followup Questions - /invocations", () => {
  test("should handle simple followup question with context", async () => {
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
    const { fullOutput, events } = parseSSEStream(text);
    const hasTextDelta = events.some((e) => e.type === "response.output_text.delta");

    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);
    expect(fullOutput.toLowerCase()).toContain("blue");
  }, 60000);

  test("should handle multi-turn conversation with calculations", async () => {
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
    const { fullOutput, events } = parseSSEStream(text);
    const hasTextDelta = events.some((e) => e.type === "response.output_text.delta");

    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);

    const hasResult = fullOutput.includes("600") || fullOutput.toLowerCase().includes("calculation");
    expect(hasResult).toBe(true);
  }, 60000);

  test("should handle empty previous message history edge case", async () => {
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

    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);
  }, 60000);

  test("REGRESSION: should handle followup after tool call", async () => {
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
    const { fullOutput, events } = parseSSEStream(text);
    const hasTextDelta = events.some((e) => e.type === "response.output_text.delta");

    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);

    const lowerOutput = fullOutput.toLowerCase();
    const mentionedTime = lowerOutput.includes("9:30") ||
                         lowerOutput.includes("930") ||
                         lowerOutput.includes("tokyo");
    expect(mentionedTime).toBe(true);
  }, 60000);
});

describe("Followup Questions - /api/chat", () => {
  test("should handle followup via useChat format", async () => {
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

    expect(response.ok).toBe(true);
    const text = await response.text();
    const { fullContent, hasTextDelta } = parseAISDKStream(text);

    expect(hasTextDelta).toBe(true);
    expect(fullContent.length).toBeGreaterThan(0);

    const mentionsContext = fullContent.toLowerCase().includes("purple") ||
                           fullContent.toLowerCase().includes("elephant");
    expect(mentionsContext).toBe(true);
  }, 60000);

  test("should handle complex multi-turn via useChat", async () => {
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

    expect(response.ok).toBe(true);
    const text = await response.text();
    const { fullContent, hasTextDelta } = parseAISDKStream(text);

    expect(hasTextDelta).toBe(true);
    expect(fullContent.length).toBeGreaterThan(0);

    const hasSum = fullContent.includes("38") || fullContent.toLowerCase().includes("total");
    expect(hasSum).toBe(true);
  }, 60000);
});
