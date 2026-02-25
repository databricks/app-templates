/**
 * Tests for the LangChain agent
 */

import { describe, test, expect, beforeAll } from "@jest/globals";
import { createAgent } from "../src/agent.js";
import { getOutput } from "./helpers.js";

describe("Agent", () => {
  let agent: Awaited<ReturnType<typeof createAgent>>;

  beforeAll(async () => {
    // Create agent with basic tools only (no MCP for tests)
    agent = await createAgent({
      model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
      temperature: 0,
    });
  });

  test("should initialize agent successfully", () => {
    expect(agent).toBeDefined();
  });

  test("should respond to simple queries", async () => {
    const result = await agent.invoke({
      input: "Hello, how are you?",
    });

    expect(result).toBeDefined();
    const output = getOutput(result);
    expect(output).toBeTruthy();
    expect(typeof output).toBe("string");
  }, 30000);

  test("should use time tool", async () => {
    const result = await agent.invoke({
      input: "What time is it in Tokyo?",
    });

    expect(result).toBeDefined();
    const output = getOutput(result);
    expect(output).toBeTruthy();

    // Verify time tool was used by checking output mentions time
    const mentionsTime =
      output.toLowerCase().includes("time") ||
      /\d{1,2}:\d{2}/.test(output) ||  // Matches HH:MM format
      output.toLowerCase().includes("tokyo");
    expect(mentionsTime).toBe(true);
  }, 30000);

  test("should handle multi-turn conversations", async () => {
    const firstResult = await agent.invoke({
      input: "My name is Alice.",
      chat_history: [],
    });

    const firstOutput = getOutput(firstResult);
    expect(firstOutput).toBeTruthy();

    const secondResult = await agent.invoke({
      input: "What is my name?",
      chat_history: [
        { role: "user", content: "My name is Alice." },
        { role: "assistant", content: firstOutput },
      ],
    });

    const secondOutput = getOutput(secondResult);
    expect(secondOutput.toLowerCase()).toContain("alice");
  }, 60000);
});
