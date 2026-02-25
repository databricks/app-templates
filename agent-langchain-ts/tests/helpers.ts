/**
 * Common test utilities and helpers
 * Reduces duplication across test files
 */

// ============================================================================
// Configuration
// ============================================================================

export const TEST_CONFIG = {
  AGENT_URL: process.env.AGENT_URL || "http://localhost:5001",
  UI_URL: process.env.UI_URL || "http://localhost:3001",
  DEFAULT_MODEL: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
  DEFAULT_TIMEOUT: 30000,
} as const;

// ============================================================================
// Request Helpers
// ============================================================================

export interface InvocationsRequest {
  input: Array<{
    role: "user" | "assistant" | "system";
    content: string | any[];
  }>;
  stream?: boolean;
}

/**
 * Call /invocations endpoint with Responses API format
 */
export async function callInvocations(
  body: InvocationsRequest,
  baseUrl = TEST_CONFIG.AGENT_URL
): Promise<Response> {
  const response = await fetch(`${baseUrl}/invocations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response;
}

/**
 * Create authorization headers with Bearer token
 */
export function makeAuthHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
}

// ============================================================================
// SSE Stream Parsing
// ============================================================================

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

/**
 * Parse Server-Sent Events (SSE) stream from response
 */
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

        // Extract text deltas
        if (data.type === "response.output_text.delta") {
          fullOutput += data.delta;
        }

        // Track errors
        if (data.type === "error" || data.type === "response.failed") {
          hasError = true;
        }

        // Track tool calls
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
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return { events, fullOutput, hasError, hasToolCall, toolCalls };
}

/**
 * Parse AI SDK streaming format (used by /api/chat)
 */
export function parseAISDKStream(text: string): {
  fullContent: string;
  hasTextDelta: boolean;
  hasToolCall: boolean;
} {
  let fullContent = "";
  let hasTextDelta = false;
  let hasToolCall = false;

  const lines = text.split("\n").filter((line) => line.trim());

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "text-delta") {
          fullContent += data.delta;
          hasTextDelta = true;
        }
        if (data.type === "tool-input-available") {
          hasToolCall = true;
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return { fullContent, hasTextDelta, hasToolCall };
}

// ============================================================================
// Authentication Helpers
// ============================================================================

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Get OAuth token for deployed app testing (async version)
 * Use in beforeAll() hooks for test suites
 */
export async function getDeployedAuthToken(): Promise<string> {
  try {
    const { stdout } = await execAsync("databricks auth token --profile dogfood");
    const tokenData = JSON.parse(stdout.trim());
    return tokenData.access_token;
  } catch (error) {
    throw new Error(`Failed to get auth token: ${error}`);
  }
}


// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that an SSE stream completed (contains "data: [DONE]")
 */
export function assertStreamComplete(text: string): void {
  expect(text).toContain("data: [DONE]");
}

/**
 * Extract the first text output from a ResponseOutputItem array.
 * Use this in tests that call agent.invoke() directly.
 */
export function getOutput(items: Awaited<ReturnType<import("../src/framework/agent-interface.js").AgentInterface["invoke"]>>): string {
  for (const item of items) {
    if (item.type === "message") {
      for (const content of (item as any).content) {
        if (content.type === "output_text") {
          return content.text as string;
        }
      }
    }
  }
  return "";
}
