/**
 * E2E test for useChat compatibility with /api/chat endpoint
 * Tests that the UI backend's /api/chat works with Vercel AI SDK's useChat hook
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";

describe("useChat E2E Test", () => {
  let agentProcess: ChildProcess;
  let uiProcess: ChildProcess;
  const AGENT_PORT = 5556;
  const UI_PORT = 5557;

  beforeAll(async () => {
    // Start agent server
    agentProcess = spawn("tsx", ["src/server.ts"], {
      env: { ...process.env, PORT: AGENT_PORT.toString() },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Start UI server with API_PROXY
    uiProcess = spawn("npm", ["run", "dev:server"], {
      cwd: "./ui/server",
      env: {
        ...process.env,
        PORT: UI_PORT.toString(),
        API_PROXY: `http://localhost:${AGENT_PORT}/invocations`,
        DATABRICKS_CONFIG_PROFILE: process.env.DATABRICKS_CONFIG_PROFILE || "dogfood",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for both servers to start
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }, 30000);

  afterAll(async () => {
    if (agentProcess) agentProcess.kill();
    if (uiProcess) uiProcess.kill();
  });

  test("should handle useChat request format", async () => {
    // Simulate what useChat sends
    const response = await fetch(`http://localhost:${UI_PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "test-chat-123",
        message: {
          role: "user",
          parts: [{ type: "text", text: "Say 'useChat test' and nothing else" }],
          id: "msg-123",
        },
        selectedChatModel: "test-model",
        selectedVisibilityType: "private",
        nextMessageId: "msg-456",
      }),
    });

    expect(response.ok).toBe(true);

    // Should return AI SDK streaming format
    const text = await response.text();
    const lines = text.split("\n").filter((line) => line.trim());

    // AI SDK format uses newline-delimited JSON
    // Format: 0:"text chunk" or 0:{message object}
    const hasTextChunks = lines.some((line) => {
      return line.startsWith('0:"') || line.startsWith("0:{");
    });

    expect(hasTextChunks).toBe(true);

    // Should contain the response text
    const fullContent = lines.join("");
    expect(fullContent.length).toBeGreaterThan(0);
  }, 30000);

  test("should handle multi-turn conversations with previousMessages", async () => {
    const response = await fetch(`http://localhost:${UI_PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "test-chat-456",
        message: {
          role: "user",
          parts: [{ type: "text", text: "What did I just say?" }],
          id: "msg-789",
        },
        previousMessages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Remember this: blue elephant" }],
            id: "msg-000",
          },
          {
            role: "assistant",
            parts: [{ type: "text", text: "I'll remember: blue elephant" }],
            id: "msg-001",
          },
        ],
        selectedChatModel: "test-model",
        selectedVisibilityType: "private",
        nextMessageId: "msg-1011",
      }),
    });

    expect(response.ok).toBe(true);

    const text = await response.text();
    const fullContent = text.toLowerCase();

    // Should reference the previous context
    expect(fullContent.includes("blue") || fullContent.includes("elephant")).toBe(true);
  }, 30000);

  test("should handle tool calling through useChat", async () => {
    const response = await fetch(`http://localhost:${UI_PORT}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "test-chat-789",
        message: {
          role: "user",
          parts: [{ type: "text", text: "Calculate 9 * 7" }],
          id: "msg-calc",
        },
        selectedChatModel: "test-model",
        selectedVisibilityType: "private",
        nextMessageId: "msg-calc-next",
      }),
    });

    expect(response.ok).toBe(true);

    const text = await response.text();
    const fullContent = text.toLowerCase();

    // Should contain the result (63)
    expect(fullContent.includes("63")).toBe(true);
  }, 30000);
});
