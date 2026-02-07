/**
 * Tests for the LangChain agent
 */

import { describe, test, expect, beforeAll } from "@jest/globals";
import { createAgent } from "../src/agent.js";
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

    // Should have used the calculator tool
    expect(result.intermediateSteps?.length).toBeGreaterThan(0);

    // Check if calculator was used (tool name is in action.tool field)
    const usedCalculator = result.intermediateSteps?.some(
      (step: any) => {
        const toolName = step.action?.tool || step.action;
        return toolName === "calculator";
      }
    );
    expect(usedCalculator).toBe(true);
  }, 30000);

  test("should use weather tool", async () => {
    const result = await agent.invoke({
      input: "What's the weather in New York?",
    });

    expect(result).toBeDefined();
    expect(result.output).toBeTruthy();

    // Should have used the weather tool
    const usedWeather = result.intermediateSteps?.some(
      (step: any) => {
        const toolName = step.action?.tool || step.action;
        return toolName === "get_weather";
      }
    );
    expect(usedWeather).toBe(true);
  }, 30000);

  test("should use time tool", async () => {
    const result = await agent.invoke({
      input: "What time is it in Tokyo?",
    });

    expect(result).toBeDefined();
    expect(result.output).toBeTruthy();

    // Should have used the time tool
    const usedTime = result.intermediateSteps?.some(
      (step: any) => {
        const toolName = step.action?.tool || step.action;
        return toolName === "get_current_time";
      }
    );
    expect(usedTime).toBe(true);
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
