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
      // Basic eval for demonstration - use mathjs or similar in production
      // eslint-disable-next-line no-eval
      const result = eval(expression);
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
 * Get basic function tools
 */
export function getBasicTools() {
  // Per PR feedback: keep only time tool, remove contrived examples
  return [timeTool];
}

/**
 * Configuration for MCP servers
 */
export interface MCPConfig {
  /**
   * Enable Databricks SQL MCP server
   */
  enableSql?: boolean;

  /**
   * Unity Catalog function configuration
   */
  ucFunction?: {
    catalog: string;
    schema: string;
    functionName?: string;
  };

  /**
   * Vector Search configuration
   */
  vectorSearch?: {
    catalog: string;
    schema: string;
    indexName?: string;
  };

  /**
   * Genie Space configuration
   */
  genieSpace?: {
    spaceId: string;
  };
}

/**
 * Initialize MCP tools from Databricks services
 *
 * @param config - MCP configuration
 * @returns Array of LangChain tools from MCP servers
 */
export async function getMCPTools(config: MCPConfig) {
  const servers: any[] = [];

  // Add Databricks SQL server
  if (config.enableSql) {
    servers.push(
      new DatabricksMCPServer({
        name: "dbsql",
        path: "/api/2.0/mcp/sql",
      })
    );
  }

  // Add Unity Catalog function server
  if (config.ucFunction) {
    servers.push(
      DatabricksMCPServer.fromUCFunction(
        config.ucFunction.catalog,
        config.ucFunction.schema,
        config.ucFunction.functionName
      )
    );
  }

  // Add Vector Search server
  if (config.vectorSearch) {
    servers.push(
      DatabricksMCPServer.fromVectorSearch(
        config.vectorSearch.catalog,
        config.vectorSearch.schema,
        config.vectorSearch.indexName
      )
    );
  }

  // Add Genie Space server
  if (config.genieSpace) {
    servers.push(
      DatabricksMCPServer.fromGenieSpace(config.genieSpace.spaceId)
    );
  }

  // No servers configured
  if (servers.length === 0) {
    console.warn("No MCP servers configured");
    return [];
  }

  try {
    // Build MCP server configurations
    const mcpServers = await buildMCPServerConfig(servers);

    // Create multi-server client
    const client = new MultiServerMCPClient({
      mcpServers,
      throwOnLoadError: false,
      prefixToolNameWithServerName: true,
    });

    // Get tools from all servers
    const tools = await client.getTools();

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
 * Get all configured tools (basic + MCP)
 */
export async function getAllTools(mcpConfig?: MCPConfig) {
  const basicTools = getBasicTools();

  if (!mcpConfig) {
    return basicTools;
  }

  try {
    const mcpTools = await getMCPTools(mcpConfig);
    return [...basicTools, ...mcpTools];
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to load MCP tools, using basic tools only:", message);
    return basicTools;
  }
}
