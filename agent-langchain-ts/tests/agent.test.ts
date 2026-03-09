/**
 * Tests for the agent via AppKit.
 *
 * These tests exercise the agent plugin with the template's tools.
 * They require a live Databricks model endpoint (DATABRICKS_MODEL env var).
 */

import { describe, test, expect, beforeAll } from "@jest/globals";
import { createApp, agent, server } from "@databricks/appkit";
import type { AgentInterface, ResponseStreamEvent } from "@databricks/appkit";
import { basicTools } from "../src/tools.js";

describe("Agent", () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    app = await createApp({
      plugins: [
        agent({
          model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
          temperature: 0,
          tools: basicTools,
        }),
        server({ autoStart: false }),
      ],
    });
  });

  test("should initialize agent successfully", () => {
    expect(app.agent).toBeDefined();
  });

  test("should respond to simple queries", async () => {
    const result = await app.agent.invoke([
      { role: "user", content: "Hello, how are you?" },
    ]);

    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 30000);

  test("should use time tool", async () => {
    const result = await app.agent.invoke([
      { role: "user", content: "What time is it in Tokyo?" },
    ]);

    expect(result).toBeTruthy();
    const mentionsTime =
      result.toLowerCase().includes("time") ||
      /\d{1,2}:\d{2}/.test(result) ||
      result.toLowerCase().includes("tokyo");
    expect(mentionsTime).toBe(true);
  }, 30000);

  test("should stream responses", async () => {
    const events: ResponseStreamEvent[] = [];
    for await (const event of app.agent.stream([
      { role: "user", content: "Say hello briefly" },
    ])) {
      events.push(event as ResponseStreamEvent);
    }

    expect(events.length).toBeGreaterThan(0);
    const hasDelta = events.some(
      (e) => e.type === "response.output_text.delta",
    );
    expect(hasDelta).toBe(true);

    const hasCompleted = events.some(
      (e) => e.type === "response.completed",
    );
    expect(hasCompleted).toBe(true);
  }, 30000);
});
