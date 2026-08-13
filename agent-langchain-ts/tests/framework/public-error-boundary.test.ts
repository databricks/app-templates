import { Config, ConfigError } from "@databricks/sdk-experimental";
import { describe, expect, test } from "@jest/globals";
import { StandardAgent } from "../../src/agent.js";

function sdkAuthFailure() {
  const sentinel = "sdk-auth-sentinel-value";
  const marker = "SDK_FULL_ENV_MARKER";
  const config = new Config({
    env: {
      DATABRICKS_TOKEN: sentinel,
      [marker]: "environment-must-not-serialize",
    },
  });
  return {
    sentinel,
    marker,
    error: new ConfigError(
      `ChatDatabricks authentication failed: Authorization: Bearer ${sentinel}`,
      config,
    ),
  };
}

describe("StandardAgent public error boundary", () => {
  test.each(["invoke", "stream"] as const)(
    "sanitizes a real ChatDatabricks SDK auth failure from %s",
    async (boundary) => {
      const failure = sdkAuthFailure();
      const rawAgent = {
        async invoke() {
          throw failure.error;
        },
        async *streamEvents() {
          throw failure.error;
        },
      };
      const agent = new StandardAgent(rawAgent as never, "system");

      let caught: unknown;
      try {
        if (boundary === "invoke") {
          await agent.invoke({ input: "hello" });
        } else {
          for await (const _event of agent.stream({ input: "hello" })) {
            // The auth failure occurs before the first event.
          }
        }
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBe(failure.error);
      const serialized = JSON.stringify(caught);
      expect(serialized).not.toContain(failure.sentinel);
      expect(serialized).not.toContain(failure.marker);
      expect(serialized).not.toContain("environment-must-not-serialize");
      expect(String(caught)).toContain("Authorization: [REDACTED]");
    },
  );
});
