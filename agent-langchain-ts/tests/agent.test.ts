/**
 * Tests for the LangChain agent
 */

import { describe, test, expect, beforeAll } from "@jest/globals";
import { createAgent, invokeAgent } from "../src/agent.js";
import type { AgentExecutor } from "langchain/agents";

describe("Agent", () => {
  let agent: AgentExecutor;

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
    const response = await invokeAgent(agent, "Hello, how are you?");

    expect(response).toBeDefined();
    expect(response.output).toBeTruthy();
    expect(typeof response.output).toBe("string");
  }, 30000);

  test("should use calculator tool", async () => {
    const response = await invokeAgent(agent, "Calculate 123 * 456");

    expect(response).toBeDefined();
    expect(response.output).toBeTruthy();

    // Should have used the calculator tool
    expect(response.intermediateSteps?.length).toBeGreaterThan(0);

    const usedCalculator = response.intermediateSteps?.some(
      (step) => step.action === "calculator"
    );
    expect(usedCalculator).toBe(true);
  }, 30000);

  test("should use weather tool", async () => {
    const response = await invokeAgent(
      agent,
      "What's the weather in New York?"
    );

    expect(response).toBeDefined();
    expect(response.output).toBeTruthy();

    // Should have used the weather tool
    const usedWeather = response.intermediateSteps?.some(
      (step) => step.action === "get_weather"
    );
    expect(usedWeather).toBe(true);
  }, 30000);

  test("should use time tool", async () => {
    const response = await invokeAgent(
      agent,
      "What time is it in Tokyo?"
    );

    expect(response).toBeDefined();
    expect(response.output).toBeTruthy();

    // Should have used the time tool
    const usedTime = response.intermediateSteps?.some(
      (step) => step.action === "get_current_time"
    );
    expect(usedTime).toBe(true);
  }, 30000);

  test("should handle multi-turn conversations", async () => {
    const firstResponse = await invokeAgent(
      agent,
      "What is 10 + 20?",
      []
    );

    expect(firstResponse.output).toBeTruthy();

    const secondResponse = await invokeAgent(
      agent,
      "Now multiply that by 3",
      [
        { role: "user", content: "What is 10 + 20?" },
        { role: "assistant", content: firstResponse.output },
      ]
    );

    expect(secondResponse.output).toBeTruthy();
  }, 60000);
});
