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
  custom_inputs?: Record<string, any>;
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
 * Call /api/chat endpoint with useChat format
 */
export async function callApiChat(
  message: string,
  options: {
    previousMessages?: any[];
    chatModel?: string;
    baseUrl?: string;
  } = {}
): Promise<Response> {
  const {
    previousMessages = [],
    chatModel = "test-model",
    baseUrl = TEST_CONFIG.UI_URL,
  } = options;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: `test-${Date.now()}`,
      message: {
        role: "user",
        parts: [{ type: "text", text: message }],
        id: `msg-${Date.now()}`,
      },
      previousMessages,
      selectedChatModel: chatModel,
      selectedVisibilityType: "private",
      nextMessageId: `next-${Date.now()}`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response;
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
// Agent Creation Helpers
// ============================================================================

/**
 * Create test agent with default configuration
 */
export async function createTestAgent(config: {
  temperature?: number;
  model?: string;
  mcpServers?: any[];
} = {}) {
  const { createAgent } = await import("../src/agent.js");
  return createAgent({
    model: config.model || TEST_CONFIG.DEFAULT_MODEL,
    temperature: config.temperature ?? 0,
    mcpServers: config.mcpServers,
  });
}

// ============================================================================
// MCP Configuration Helpers
// ============================================================================

export const MCP = {
  /**
   * Check if SQL MCP is configured
   */
  isSqlConfigured: (): boolean => {
    return process.env.ENABLE_SQL_MCP === "true";
  },

  /**
   * Check if UC Function is configured
   */
  isUCFunctionConfigured: (): boolean => {
    return !!(
      process.env.UC_FUNCTION_CATALOG && process.env.UC_FUNCTION_SCHEMA
    );
  },

  /**
   * Check if Vector Search is configured
   */
  isVectorSearchConfigured: (): boolean => {
    return !!(
      process.env.VECTOR_SEARCH_CATALOG && process.env.VECTOR_SEARCH_SCHEMA
    );
  },

  /**
   * Check if Genie Space is configured
   */
  isGenieConfigured: (): boolean => {
    return !!process.env.GENIE_SPACE_ID;
  },

  /**
   * Check if any MCP tool is configured
   */
  isAnyConfigured(): boolean {
    return (
      this.isSqlConfigured() ||
      this.isUCFunctionConfigured() ||
      this.isVectorSearchConfigured() ||
      this.isGenieConfigured()
    );
  },

  /**
   * Skip test if MCP not configured
   */
  skipIfNotConfigured(condition: boolean, message: string): boolean {
    if (!condition) {
      console.log(`⏭️  ${message}`);
      return true;
    }
    return false;
  },

  /**
   * Get UC Function config from environment
   */
  getUCFunctionConfig() {
    if (!this.isUCFunctionConfigured()) return undefined;
    return {
      catalog: process.env.UC_FUNCTION_CATALOG!,
      schema: process.env.UC_FUNCTION_SCHEMA!,
      functionName: process.env.UC_FUNCTION_NAME,
    };
  },

  /**
   * Get Vector Search config from environment
   */
  getVectorSearchConfig() {
    if (!this.isVectorSearchConfigured()) return undefined;
    return {
      catalog: process.env.VECTOR_SEARCH_CATALOG!,
      schema: process.env.VECTOR_SEARCH_SCHEMA!,
      indexName: process.env.VECTOR_SEARCH_INDEX,
    };
  },

  /**
   * Get Genie Space config from environment
   */
  getGenieConfig() {
    if (!this.isGenieConfigured()) return undefined;
    return {
      spaceId: process.env.GENIE_SPACE_ID!,
    };
  },
};

// ============================================================================
// Authentication Helpers
// ============================================================================

import { exec } from "child_process";
import { execSync } from "child_process";
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

/**
 * Get auth headers for deployed app testing (sync version)
 * Automatically detects if URL is deployed app and gets token
 */
export function getDeployedAuthHeaders(
  agentUrl: string = TEST_CONFIG.AGENT_URL
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Only add auth for deployed apps
  if (agentUrl.includes("databricksapps.com")) {
    let token = process.env.DATABRICKS_TOKEN;

    // Try to get token from CLI if not in env
    if (!token) {
      try {
        const tokenJson = execSync("databricks auth token --profile dogfood", {
          encoding: "utf-8",
        });
        const parsed = JSON.parse(tokenJson);
        token = parsed.access_token;
      } catch (error) {
        console.warn("Warning: Could not get OAuth token.");
      }
    }

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  return headers;
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that response contains expected text (case-insensitive)
 */
export function assertContains(text: string, expected: string): boolean {
  return text.toLowerCase().includes(expected.toLowerCase());
}

/**
 * Assert that SSE stream completed successfully
 */
export function assertSSECompleted(text: string): boolean {
  return text.includes("data: [DONE]");
}

/**
 * Assert that SSE stream has completion event
 */
export function assertSSEHasCompletionEvent(events: SSEEvent[]): boolean {
  return events.some(
    (e) => e.type === "response.completed" || e.type === "response.failed"
  );
}
