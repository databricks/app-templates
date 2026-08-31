/**
 * Common test utilities and helpers
 */

export const TEST_CONFIG = {
  AGENT_URL: process.env.AGENT_URL || "http://localhost:5001",
  UI_URL: process.env.UI_URL || "http://localhost:3001",
  DEFAULT_MODEL: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
  DEFAULT_TIMEOUT: 30000,
} as const;

export function makeAuthHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export interface SSEEvent {
  type: string;
  [key: string]: any;
}

export interface ParsedSSEStream {
  events: SSEEvent[];
  fullOutput: string;
  hasError: boolean;
  hasToolCall: boolean;
  toolCalls: Array<{ name: string; arguments: any }>;
}

export function parseSSEStream(text: string): ParsedSSEStream {
  const events: SSEEvent[] = [];
  let fullOutput = "";
  let hasError = false;
  let hasToolCall = false;
  const toolCalls: Array<{ name: string; arguments: any }> = [];

  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const data = JSON.parse(line.slice(6));
        events.push(data);

        if (data.type === "response.output_text.delta") {
          fullOutput += data.delta;
        }
        if (data.type === "error" || data.type === "response.failed") {
          hasError = true;
        }
        if (
          data.type === "response.output_item.done" &&
          data.item?.type === "function_call"
        ) {
          hasToolCall = true;
          toolCalls.push({
            name: data.item.name,
            arguments: JSON.parse(data.item.arguments || "{}"),
          });
        }
      } catch {}
    }
  }
  return { events, fullOutput, hasError, hasToolCall, toolCalls };
}

export function assertStreamComplete(text: string): void {
  if (!text.includes("data: [DONE]")) {
    throw new Error("Stream did not complete — missing data: [DONE]");
  }
}

import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

export async function getDeployedAuthToken(): Promise<string> {
  try {
    const profile = process.env.DATABRICKS_CLI_PROFILE;
    const profileFlag = profile ? `--profile ${profile}` : "";
    const { stdout } = await execAsync(`databricks auth token ${profileFlag}`.trim());
    const tokenData = JSON.parse(stdout.trim());
    return tokenData.access_token;
  } catch (error) {
    throw new Error(`Failed to get auth token: ${error}`);
  }
}
