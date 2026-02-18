import { expect, test } from "@playwright/test";
import { shouldInjectContextForEndpoint } from "@chat-template/ai-sdk-providers";

test.describe("Request Context Utils", () => {
  test.describe("shouldInjectContextForEndpoint", () => {
    const originalEnv = process.env.API_PROXY;

    test.beforeEach(() => {
      process.env.API_PROXY = undefined;
    });

    test.afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.API_PROXY = originalEnv;
      } else {
        process.env.API_PROXY = undefined;
      }
    });

    test("returns true when API_PROXY is set", () => {
      process.env.API_PROXY = "http://proxy.example.com";
      expect(shouldInjectContextForEndpoint(undefined)).toBe(true);
      expect(shouldInjectContextForEndpoint("llm/v1/chat")).toBe(true);
      expect(shouldInjectContextForEndpoint("agent/v2/chat")).toBe(true);
    });

    test("returns true for agent/v2/chat endpoint task", () => {
      expect(shouldInjectContextForEndpoint("agent/v2/chat")).toBe(true);
    });

    test("returns true for agent/v1/responses endpoint task", () => {
      expect(shouldInjectContextForEndpoint("agent/v1/responses")).toBe(true);
    });

    test("returns false for llm/v1/chat endpoint task", () => {
      expect(shouldInjectContextForEndpoint("llm/v1/chat")).toBe(false);
    });

    test("returns false for undefined endpoint task", () => {
      expect(shouldInjectContextForEndpoint(undefined)).toBe(false);
    });

    test("returns false for agent/v2/responses endpoint task (not in allowed list)", () => {
      expect(shouldInjectContextForEndpoint("agent/v2/responses")).toBe(false);
    });

    test("returns false for empty string endpoint task", () => {
      expect(shouldInjectContextForEndpoint("")).toBe(false);
    });

    test("returns false for unknown endpoint task", () => {
      expect(shouldInjectContextForEndpoint("some/other/task")).toBe(false);
    });
  });
});
