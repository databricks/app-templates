/**
 * Multi-turn conversation tests for /invocations
 * Verifies that conversation history (including tool calls) is handled correctly
 *
 * Run with: npm run test:integration
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { parseSSEStream } from "../helpers.js";

const PORT = 5559;
const AGENT_URL = `http://localhost:${PORT}`;
let agentProcess: ChildProcess;

beforeAll(async () => {
  agentProcess = spawn("node_modules/.bin/tsx", ["tests/framework/stub-server.ts"], {
    env: { ...process.env, PORT: PORT.toString(), MLFLOW_TRACKING_URI: "noop" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try {
      const r = await fetch(`${AGENT_URL}/health`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
}, 30000);

afterAll(() => {
  if (agentProcess) agentProcess.kill();
});

describe("Multi-turn conversations - /invocations", () => {
  test("should handle simple followup question with context", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    expect(events.some((e) => e.type === "response.output_text.delta")).toBe(true);
    expect(fullOutput).toContain("Echo:");
  }, 30000);

  test("should handle followup after tool call", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: [
          { role: "user", content: "Look up the answer for me" },
          {
            role: "assistant",
            content: [
              {
                type: "function_call",
                name: "some_tool",
                arguments: '{"query":"test"}',
              },
              {
                type: "function_call_output",
                output: '"The answer is 42"',
              },
              {
                type: "output_text",
                text: "The answer is 42.",
              },
            ],
          },
          { role: "user", content: "What did you just tell me?" },
        ],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    const { fullOutput } = parseSSEStream(text);
    // The value of this test is that the framework parses function_call/function_call_output
    // history items without crashing. The stub returning any response proves that.
    expect(fullOutput.length).toBeGreaterThan(0);
    expect(fullOutput).toContain("Echo:");
  }, 30000);

  test("should handle empty previous message history", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: [{ role: "user", content: "What did I just tell you?" }],
        stream: true,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    const { fullOutput } = parseSSEStream(text);
    expect(fullOutput.length).toBeGreaterThan(0);
  }, 30000);
});
