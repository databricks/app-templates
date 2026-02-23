/**
 * Tool loading for LangChain agent following MCP (Model Context Protocol) pattern.
 *
 * MCP Pattern Overview:
 * 1. Define basic tools using LangChain's tool() function
 * 2. Connect to MCP servers (Databricks SQL, UC Functions, Vector Search, Genie)
 * 3. Load MCP tools using MultiServerMCPClient from @langchain/mcp-adapters
 * 4. Combine basic + MCP tools for agent use
 *
 * Key components:
 * - @langchain/mcp-adapters: Standard LangChain MCP adapters
 * - @databricks/langchainjs: Databricks-specific MCP server configurations
 * - MultiServerMCPClient: Manages connections to multiple MCP servers
 *
 * References:
 * - https://js.langchain.com/docs/integrations/tools/mcp
 * - https://modelcontextprotocol.io/
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  DatabricksMCPServer,
  buildMCPServerConfig,
} from "@databricks/langchainjs";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

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
export const basicTools = [timeTool];

/**
 * Global MCP client reference (singleton pattern)
 *
 * Keep the client alive across agent invocations to maintain connections.
 * MCP clients manage persistent connections to external tool servers.
 *
 * IMPORTANT for testing:
 * - This singleton persists across test cases in the same Jest process
 * - Unit tests should mock getMCPTools() to avoid stale connections:
 *   jest.mock('./tools.js', () => ({
 *     ...jest.requireActual('./tools.js'),
 *     getMCPTools: jest.fn().mockResolvedValue([])
 *   }))
 * - Integration tests can safely call getMCPTools() as connections are reusable
 */
let globalMCPClient: MultiServerMCPClient | null = null;

/**
 * Load tools from MCP servers using standard MCP adapter pattern
 *
 * Pattern:
 * 1. Build MCP server configurations (handles Databricks auth)
 * 2. Create MultiServerMCPClient (connects to all servers)
 * 3. Call getTools() to load tools from all connected servers
 * 4. Returns LangChain StructuredTool[] ready for agent use
 *
 * The MultiServerMCPClient automatically:
 * - Prefixes tool names with server name to avoid conflicts
 * - Handles connection management and retries
 * - Converts MCP tools to LangChain tool format
 *
 * @param servers - Array of DatabricksMCPServer instances
 * @returns Array of LangChain tools from MCP servers
 */
export async function getMCPTools(servers: DatabricksMCPServer[]) {
  if (servers.length === 0) {
    console.log("ℹ️  No MCP servers configured, using basic tools only");
    return [];
  }

  try {
    // Step 1: Build MCP server configurations (Databricks-specific)
    const mcpServers = await buildMCPServerConfig(servers);

    // Step 2: Create multi-server client from @langchain/mcp-adapters
    globalMCPClient = new MultiServerMCPClient({
      mcpServers,
      throwOnLoadError: false,
      prefixToolNameWithServerName: true,
    });

    // Step 3: Load all tools from connected servers
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
