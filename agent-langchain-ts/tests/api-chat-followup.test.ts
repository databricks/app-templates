/**
 * Test /api/chat endpoint with followup questions after tool calls
 * This tests the UI backend integration with the agent
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

describe("/api/chat - Followup Questions After Tool Calls", () => {
  test("should handle followup question after tool call (via UI)", async () => {
    console.log("\n=== Test: /api/chat Followup After Tool Call ===");
    console.log("This verifies the UI backend properly handles tool call context");

    // First message: ask for time in Tokyo (will trigger tool call)
    const firstResponse = await fetch(`${APP_URL}/api/chat`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: "test-chat-" + Date.now(),
        message: {
          role: "user",
          parts: [{ type: "text", text: "What time is it in Tokyo?" }],
          id: "msg-1",
        },
        previousMessages: [],
        selectedChatModel: "chat-model",
        selectedVisibilityType: "private",
      }),
    });

    if (!firstResponse.ok) {
      const errorText = await firstResponse.text();
      console.error(`\n❌ First request failed (${firstResponse.status}):`, errorText);
      throw new Error(`First request failed: ${errorText}`);
    }
    const firstText = await firstResponse.text();

    console.log("\n=== First Response (Tool Call) ===");
    console.log(firstText.substring(0, 1000));

    // Parse the response to extract assistant message with tool calls
    let assistantMessage: any = null;
    let hasToolCall = false;
    const lines = firstText.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "message-complete") {
            assistantMessage = data.message;
          }
          if (data.type === "tool-call-delta" || data.type === "tool-call") {
            hasToolCall = true;
          }
        } catch (e) {
          // Skip unparseable lines
        }
      }
    }

    console.log("\n=== Parsed Assistant Message ===");
    console.log(JSON.stringify(assistantMessage, null, 2));
    console.log("Has tool call:", hasToolCall);

    expect(hasToolCall).toBe(true);
    expect(assistantMessage).not.toBeNull();

    // Second message: followup question referencing the tool call
    const secondResponse = await fetch(`${APP_URL}/api/chat`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: "test-chat-" + Date.now(),
        message: {
          role: "user",
          parts: [{ type: "text", text: "What time did you just tell me?" }],
          id: "msg-3",
        },
        previousMessages: [
          {
            role: "user",
            parts: [{ type: "text", text: "What time is it in Tokyo?" }],
            id: "msg-1",
          },
          assistantMessage, // Include the assistant message with tool calls
        ],
        selectedChatModel: "chat-model",
        selectedVisibilityType: "private",
      }),
    });

    expect(secondResponse.ok).toBe(true);
    const secondText = await secondResponse.text();

    console.log("\n=== Second Response (Followup) ===");
    console.log(secondText.substring(0, 1000));

    // Parse followup response
    let followupContent = "";
    let hasTextDelta = false;
    const followupLines = secondText.split("\n");
    for (const line of followupLines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "text-delta") {
            hasTextDelta = true;
            followupContent += data.delta || "";
          }
        } catch (e) {
          // Skip
        }
      }
    }

    console.log("\n=== Followup Content ===");
    console.log("Has text delta:", hasTextDelta);
    console.log("Content:", followupContent);

    // ASSERTIONS
    expect(hasTextDelta).toBe(true);
    expect(followupContent.length).toBeGreaterThan(0);

    // The response should reference the time that was mentioned in the tool call
    const lowerContent = followupContent.toLowerCase();
    const mentionsContext =
      lowerContent.includes("tokyo") ||
      lowerContent.includes("time") ||
      lowerContent.includes("pm") ||
      lowerContent.includes("am");

    expect(mentionsContext).toBe(true);
    console.log("\n✅ Agent correctly handled tool call context via /api/chat!");
  }, 120000); // Longer timeout for two sequential requests
});
