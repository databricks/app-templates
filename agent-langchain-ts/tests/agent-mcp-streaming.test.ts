/**
 * Test for AgentMCP streaming bug
 * Verifies that AgentMCP.streamEvents() properly streams text deltas
 *
 * Bug: AgentMCP.streamEvents() currently waits for full response
 * and only emits on_agent_finish, causing empty responses in /api/chat
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

describe("AgentMCP Streaming Bug", () => {
  test("REPRODUCER: /invocations should stream text deltas (currently fails)", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        input: [{
          role: "user",
          content: "Say exactly: 'Hello, I am streaming text'"
        }],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();

    console.log("\n=== Raw SSE Response ===");
    console.log(text);
    console.log("=== End Response ===\n");

    // Parse SSE stream
    let fullOutput = "";
    let hasTextDelta = false;
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
        } catch {
          // Skip invalid JSON
        }
      }
    }

    console.log("Events emitted:", events);
    console.log("Has text-delta events:", hasTextDelta);
    console.log("Full output:", fullOutput);

    // THIS TEST CURRENTLY FAILS - this is the bug we're documenting
    expect(hasTextDelta).toBe(true);
    expect(fullOutput.length).toBeGreaterThan(0);
    expect(fullOutput.toLowerCase()).toContain("hello");
  }, 30000);

  test("REPRODUCER: /api/chat should have text-delta events (currently fails)", async () => {
    const response = await fetch(`${AGENT_URL}/api/chat`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        message: {
          role: "user",
          parts: [{ type: "text", text: "Say exactly: 'Testing text streaming'" }],
          id: "550e8400-e29b-41d4-a716-446655440001",
        },
        selectedChatModel: "chat-model",
        selectedVisibilityType: "private",
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();

    console.log("\n=== Raw /api/chat Response ===");
    console.log(text);
    console.log("=== End Response ===\n");

    // Parse events
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
            fullContent += data.textDelta;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    console.log("Events emitted:", events);
    console.log("Has text-delta events:", hasTextDelta);
    console.log("Full content:", fullContent);

    // THIS TEST CURRENTLY FAILS - documenting the bug
    expect(hasTextDelta).toBe(true);
    expect(fullContent.length).toBeGreaterThan(0);
  }, 30000);
});
