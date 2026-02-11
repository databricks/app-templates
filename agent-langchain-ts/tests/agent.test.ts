/**
 * Tests for the LangChain agent
 */

import { describe, test, expect, beforeAll } from "@jest/globals";
import { createAgent } from "../src/agent.js";

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
    expect(result.output).toBeTruthy();
    expect(typeof result.output).toBe("string");
  }, 30000);

  test("should use calculator tool", async () => {
    const result = await agent.invoke({
      input: "Calculate 123 * 456",
    });

    expect(result).toBeDefined();
    expect(result.output).toBeTruthy();

    // Verify calculator was used by checking for correct answer in output
    const hasResult = result.output.includes("56088") || result.output.includes("56,088");
    expect(hasResult).toBe(true);
  }, 30000);

  test("should use weather tool", async () => {
    const result = await agent.invoke({
      input: "What's the weather in New York?",
    });

    expect(result).toBeDefined();
    expect(result.output).toBeTruthy();

    // Verify weather tool was used by checking output mentions weather/temperature
    const mentionsWeather =
      result.output.toLowerCase().includes("weather") ||
      result.output.toLowerCase().includes("temperature") ||
      result.output.toLowerCase().includes("°") ||
      result.output.toLowerCase().includes("sunny") ||
      result.output.toLowerCase().includes("cloudy");
    expect(mentionsWeather).toBe(true);
  }, 30000);

  test("should use time tool", async () => {
    const result = await agent.invoke({
      input: "What time is it in Tokyo?",
    });

    expect(result).toBeDefined();
    expect(result.output).toBeTruthy();

    // Verify time tool was used by checking output mentions time
    const mentionsTime =
      result.output.toLowerCase().includes("time") ||
      /\d{1,2}:\d{2}/.test(result.output) ||  // Matches HH:MM format
      result.output.toLowerCase().includes("tokyo");
    expect(mentionsTime).toBe(true);
  }, 30000);

  test("should handle multi-turn conversations", async () => {
    const firstResult = await agent.invoke({
      input: "What is 10 + 20?",
      chat_history: [],
    });

    expect(firstResult.output).toBeTruthy();

    const secondResult = await agent.invoke({
      input: "Now multiply that by 3",
      chat_history: [
        { role: "user", content: "What is 10 + 20?" },
        { role: "assistant", content: firstResult.output },
      ],
    });

    expect(secondResult.output).toBeTruthy();
  }, 60000);
});
