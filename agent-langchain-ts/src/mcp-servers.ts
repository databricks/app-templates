/**
 * MCP Server configuration for the agent
 *
 * Define MCP servers here, similar to Python template's init_mcp_server()
 * Each server provides tools/data sources for the agent
 */

import { DatabricksMCPServer } from "@databricks/langchainjs";

/**
 * Initialize all MCP servers for the agent
 *
 * Returns an array of MCP server configurations that will be
 * loaded by the agent at startup.
 */
export function getMCPServers(): DatabricksMCPServer[] {
  const servers: DatabricksMCPServer[] = [];

  // Add MCP servers here as needed for your use case:
  // This template includes basic tools (weather, calculator, time) by default.
  // Uncomment examples below to add Databricks MCP integrations.

  // // Databricks SQL - Direct SQL queries on Unity Catalog
  // servers.push(
  //   new DatabricksMCPServer({
  //     name: "dbsql",
  //     path: "/api/2.0/mcp/sql",
  //   })
  // );

  // // UC Functions - Call Unity Catalog functions as tools
  // servers.push(
  //   DatabricksMCPServer.fromUCFunction("main", "default", undefined, {
  //     name: "uc-functions",
  //   })
  // );

  // // Vector Search - Semantic search for RAG
  // servers.push(
  //   DatabricksMCPServer.fromVectorSearch("main", "default", "my_index", {
  //     name: "vector-search",
  //   })
  // );

  return servers;
}
