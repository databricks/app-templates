/**
 * Example tools for the LangChain agent.
 *
 * Demonstrates:
 * - Simple function tools with Zod schemas
 * - MCP tool integration (Databricks SQL, UC Functions, Vector Search)
 * - Tool binding patterns
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { evaluate } from "mathjs";
import {
  DatabricksMCPServer,
  buildMCPServerConfig,
} from "@databricks/langchainjs";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

/**
 * Example: Weather lookup tool
 */
export const weatherTool = tool(
  async ({ location }) => {
    // In production, this would call a real weather API
    const conditions = ["sunny", "cloudy", "rainy", "snowy"];
    const temps = [65, 70, 75, 80];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temp = temps[Math.floor(Math.random() * temps.length)];

    return `The weather in ${location} is ${condition} with a temperature of ${temp}°F`;
  },
  {
    name: "get_weather",
    description: "Get the current weather conditions for a specific location",
    schema: z.object({
      location: z
        .string()
        .describe("The city and state, e.g. 'San Francisco, CA'"),
    }),
  }
);

/**
 * Example: Calculator tool
 */
export const calculatorTool = tool(
  async ({ expression }) => {
    try {
      // Use mathjs for safe mathematical expression evaluation
      const result = evaluate(expression);
      return `Result: ${result}`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error evaluating expression: ${message}`;
    }
  },
  {
    name: "calculator",
    description:
      "Evaluate a mathematical expression. Supports basic arithmetic operations.",
    schema: z.object({
      expression: z
        .string()
        .describe("Mathematical expression to evaluate, e.g. '2 + 2 * 3'"),
    }),
  }
);

/**
 * Example: Time tool
 */
export const timeTool = tool(
  async ({ timezone = "UTC" }) => {
    const now = new Date();
    return `Current time in ${timezone}: ${now.toLocaleString("en-US", {
      timeZone: timezone,
    })}`;
  },
  {
    name: "get_current_time",
    description: "Get the current date and time in a specific timezone",
    schema: z.object({
      timezone: z
        .string()
        .optional()
        .describe(
          "IANA timezone name, e.g. 'America/New_York', 'Europe/London', defaults to UTC"
        ),
    }),
  }
);

/**
 * Basic function tools available to the agent
 */
export const basicTools = [weatherTool, calculatorTool, timeTool];

// Global MCP client reference to keep it alive
let globalMCPClient: MultiServerMCPClient | null = null;

/**
 * Initialize MCP tools from Databricks MCP servers
 *
 * @param servers - Array of DatabricksMCPServer instances
 * @returns Array of LangChain tools from MCP servers
 */
export async function getMCPTools(servers: DatabricksMCPServer[]) {
  // No servers configured
  if (servers.length === 0) {
    console.log("ℹ️  No MCP servers configured, using basic tools only");
    return [];
  }

  try {
    // Build MCP server configurations
    const mcpServers = await buildMCPServerConfig(servers);

    // Create multi-server client and keep it alive globally
    globalMCPClient = new MultiServerMCPClient({
      mcpServers,
      throwOnLoadError: false,
      prefixToolNameWithServerName: true,
    });

    // Get tools from all servers
    const tools = await globalMCPClient.getTools();

    console.log(
      `✅ Loaded ${tools.length} MCP tools from ${servers.length} server(s)`
    );

    return tools;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error loading MCP tools:", message);
    throw error;
  }
}

/**
 * Close the global MCP client (call on shutdown)
 */
export async function closeMCPClient() {
  if (globalMCPClient) {
    await globalMCPClient.close();
    globalMCPClient = null;
    console.log("✅ MCP client closed");
  }
}

/**
 * Get all configured tools (basic + MCP)
 */
export async function getAllTools(mcpServers?: DatabricksMCPServer[]) {
  if (!mcpServers || mcpServers.length === 0) {
    return basicTools;
  }

  try {
    const mcpTools = await getMCPTools(mcpServers);
    return [...basicTools, ...mcpTools];
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to load MCP tools, using basic tools only:", message);
    return basicTools;
  }
}
