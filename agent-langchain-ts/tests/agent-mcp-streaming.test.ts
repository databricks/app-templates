/**
 * Test for AgentMCP streaming bug
 * Verifies that AgentMCP.streamEvents() properly streams text deltas
 *
 * Bug: AgentMCP.streamEvents() currently waits for full response
 * and only emits on_agent_finish, causing empty responses in /api/chat
 */

import { describe, test, expect } from '@jest/globals';
import {
  TEST_CONFIG,
  callInvocations,
  parseSSEStream,
  parseAISDKStream,
  getDeployedAuthHeaders,
  getAgentUrl,
} from './helpers.js';

const AGENT_URL = process.env.APP_URL || getAgentUrl();

describe("AgentMCP Streaming Bug", () => {
  test("REPRODUCER: /invocations should stream text deltas (currently fails)", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
      method: "POST",
      headers: getDeployedAuthHeaders(AGENT_URL),
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

    const { events, fullOutput } = parseSSEStream(text);
    const hasTextDelta = events.some(e => e.type === "response.output_text.delta");

    console.log("Events emitted:", events.map(e => e.type));
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
      headers: {
        ...getDeployedAuthHeaders(AGENT_URL),
        "X-Forwarded-User": "test-user",
        "X-Forwarded-Email": "test@example.com"
      },
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

    const { fullContent, hasTextDelta } = parseAISDKStream(text);

    console.log("Has text-delta events:", hasTextDelta);
    console.log("Full content:", fullContent);

    // THIS TEST CURRENTLY FAILS - documenting the bug
    expect(hasTextDelta).toBe(true);
    expect(fullContent.length).toBeGreaterThan(0);
  }, 30000);
});
