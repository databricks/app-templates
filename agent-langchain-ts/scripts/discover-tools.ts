#!/usr/bin/env tsx
/**
 * Discover available tools and data sources for Databricks agents.
 *
 * This script scans for:
 * - Unity Catalog functions (data retrieval tools e.g. SQL UDFs)
 * - Unity Catalog tables (data sources)
 * - Vector search indexes (RAG data sources)
 * - Genie spaces (conversational interface over structured data)
 * - Custom MCP servers (Databricks apps with name mcp-*)
 * - External MCP servers (via Unity Catalog connections)
 */

import { WorkspaceClient } from "@databricks/sdk-experimental";
import { writeFileSync } from "fs";
import { config } from "dotenv";

// Load environment variables
config();

const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_MAX_SCHEMAS = 25;

interface DiscoveryResults {
  uc_functions: any[];
  uc_tables: any[];
  vector_search_indexes: any[];
  genie_spaces: any[];
  custom_mcp_servers: any[];
  external_mcp_servers: any[];
}

/**
 * Discover Unity Catalog functions that could be used as tools.
 */
async function discoverUCFunctions(
  w: WorkspaceClient,
  catalog?: string,
  maxSchemas: number = DEFAULT_MAX_SCHEMAS
): Promise<any[]> {
  const functions: any[] = [];
  let schemasSearched = 0;

  try {
    const catalogs = catalog ? [catalog] : [];
    if (!catalog) {
      for await (const cat of w.catalogs.list({})) {
        catalogs.push(cat.name!);
      }
    }

    for (const cat of catalogs) {
      if (schemasSearched >= maxSchemas) {
        break;
      }

      try {
        const allSchemas = [];
        for await (const schema of w.schemas.list({ catalog_name: cat })) {
          allSchemas.push(schema);
        }

        // Take schemas from this catalog until we hit the global budget
        const schemasToSearch = allSchemas.slice(0, maxSchemas - schemasSearched);

        for (const schema of schemasToSearch) {
          const schema_name = `${cat}.${schema.name}`;
          try {
            for await (const func of w.functions.list({
              catalog_name: cat,
              schema_name: schema.name!,
            })) {
              functions.push({
                type: "uc_function",
                name: func.full_name,
                catalog: cat,
                schema: schema.name,
                function_name: func.name,
                comment: func.comment,
                routine_definition: func.routine_definition,
              });
            }
          } catch (error) {
            // Skip schemas we can't access
          } finally {
            schemasSearched++;
          }
        }
      } catch (error) {
        // Skip catalogs we can't access
      }
    }
  } catch (error: any) {
    console.error(`Error discovering UC functions: ${error.message}`);
  }

  return functions;
}

/**
 * Discover Unity Catalog tables that could be queried.
 */
async function discoverUCTables(
  w: WorkspaceClient,
  catalog?: string,
  schema?: string,
  maxSchemas: number = DEFAULT_MAX_SCHEMAS
): Promise<any[]> {
  const tables: any[] = [];
  let schemasSearched = 0;

  try {
    const catalogs = catalog ? [catalog] : [];
    if (!catalog) {
      for await (const cat of w.catalogs.list({})) {
        if (cat.name !== "__databricks_internal" && cat.name !== "system") {
          catalogs.push(cat.name!);
        }
      }
    }

    for (const cat of catalogs) {
      if (schemasSearched >= maxSchemas) {
        break;
      }

      try {
        const schemasToSearch: string[] = [];
        if (schema) {
          schemasToSearch.push(schema);
        } else {
          for await (const sch of w.schemas.list({ catalog_name: cat })) {
            schemasToSearch.push(sch.name!);
          }
        }

        // Take schemas until we hit the global budget
        const schemasSlice = schemasToSearch.slice(0, maxSchemas - schemasSearched);

        for (const sch of schemasSlice) {
          if (sch === "information_schema") {
            schemasSearched++;
            continue;
          }

          try {
            for await (const tbl of w.tables.list({
              catalog_name: cat,
              schema_name: sch,
            })) {
              // Get column info
              const columns: any[] = [];
              if (tbl.columns) {
                for (const col of tbl.columns) {
                  columns.push({
                    name: col.name,
                    type: col.type_name,
                  });
                }
              }

              tables.push({
                type: "uc_table",
                name: tbl.full_name,
                catalog: cat,
                schema: sch,
                table_name: tbl.name,
                table_type: tbl.table_type,
                comment: tbl.comment,
                columns,
              });
            }
          } catch (error) {
            // Skip schemas we can't access
          } finally {
            schemasSearched++;
          }
        }
      } catch (error) {
        // Skip catalogs we can't access
      }
    }
  } catch (error: any) {
    console.error(`Error discovering UC tables: ${error.message}`);
  }

  return tables;
}

/**
 * Discover Vector Search indexes for RAG applications.
 */
async function discoverVectorSearchIndexes(w: WorkspaceClient): Promise<any[]> {
  const indexes: any[] = [];

  try {
    // List all vector search endpoints
    for await (const endpoint of w.vectorSearchEndpoints.listEndpoints({})) {
      try {
        // List indexes for each endpoint
        for await (const idx of w.vectorSearchIndexes.listIndexes({
          endpoint_name: endpoint.name!,
        })) {
          indexes.push({
            type: "vector_search_index",
            name: idx.name,
            endpoint: endpoint.name,
            primary_key: idx.primary_key,
            index_type: idx.index_type,
          });
        }
      } catch (error) {
        // Skip endpoints we can't access
      }
    }
  } catch (error: any) {
    console.error(`Error discovering vector search indexes: ${error.message}`);
  }

  return indexes;
}

/**
 * Discover Genie spaces for conversational data access.
 */
async function discoverGenieSpaces(w: WorkspaceClient): Promise<any[]> {
  const spaces: any[] = [];

  try {
    // Use SDK to list genie spaces
    const response = await w.genie.listSpaces({});
    const genieSpaces = response.spaces || [];
    for (const space of genieSpaces) {
      spaces.push({
        type: "genie_space",
        id: space.space_id,
        name: space.title,
        description: space.description,
      });
    }
  } catch (error: any) {
    console.error(`Error discovering Genie spaces: ${error.message}`);
  }

  return spaces;
}

/**
 * Discover custom MCP servers deployed as Databricks apps.
 */
async function discoverCustomMCPServers(w: WorkspaceClient): Promise<any[]> {
  const customServers: any[] = [];

  try {
    // List all apps and filter for those starting with mcp-
    for await (const app of w.apps.list({})) {
      if (app.name && app.name.startsWith("mcp-")) {
        customServers.push({
          type: "custom_mcp_server",
          name: app.name,
          url: app.url,
          status: app.app_status?.state,
          description: app.description,
        });
      }
    }
  } catch (error: any) {
    console.error(`Error discovering custom MCP servers: ${error.message}`);
  }

  return customServers;
}

/**
 * Discover external MCP servers configured via Unity Catalog connections.
 */
async function discoverExternalMCPServers(w: WorkspaceClient): Promise<any[]> {
  const externalServers: any[] = [];

  try {
    // List all connections and filter for MCP connections
    for await (const conn of w.connections.list({})) {
      // Check if this is an MCP connection
      if (conn.options && (conn.options as any).is_mcp_connection === "true") {
        externalServers.push({
          type: "external_mcp_server",
          name: conn.name,
          connection_type: conn.connection_type,
          comment: conn.comment,
          full_name: conn.full_name,
        });
      }
    }
  } catch (error: any) {
    console.error(`Error discovering external MCP servers: ${error.message}`);
  }

  return externalServers;
}

/**
 * Format discovery results as markdown.
 */
function formatOutputMarkdown(results: DiscoveryResults): string {
  const lines: string[] = ["# Agent Tools and Data Sources Discovery\n"];

  // UC Functions
  const functions = results.uc_functions;
  if (functions.length > 0) {
    lines.push(`## Unity Catalog Functions (${functions.length})\n`);
    lines.push("**What they are:** SQL UDFs that can be used as agent tools.\n");
    lines.push("**How to use:** Access via UC functions MCP server:");
    lines.push("- All functions in a schema: `{workspace_host}/api/2.0/mcp/functions/{catalog}/{schema}`");
    lines.push("- Single function: `{workspace_host}/api/2.0/mcp/functions/{catalog}/{schema}/{function_name}`\n");
    for (const func of functions.slice(0, 10)) {
      lines.push(`- \`${func.name}\``);
      if (func.comment) {
        lines.push(`  - ${func.comment}`);
      }
    }
    if (functions.length > 10) {
      lines.push(`\n*...and ${functions.length - 10} more*\n`);
    }
    lines.push("");
  }

  // UC Tables
  const tables = results.uc_tables;
  if (tables.length > 0) {
    lines.push(`## Unity Catalog Tables (${tables.length})\n`);
    lines.push("Structured data that agents can query via UC SQL functions.\n");
    for (const table of tables.slice(0, 10)) {
      lines.push(`- \`${table.name}\` (${table.table_type})`);
      if (table.comment) {
        lines.push(`  - ${table.comment}`);
      }
      if (table.columns && table.columns.length > 0) {
        const colNames = table.columns.slice(0, 5).map((c: any) => c.name);
        lines.push(`  - Columns: ${colNames.join(", ")}`);
      }
    }
    if (tables.length > 10) {
      lines.push(`\n*...and ${tables.length - 10} more*\n`);
    }
    lines.push("");
  }

  // Vector Search Indexes
  const indexes = results.vector_search_indexes;
  if (indexes.length > 0) {
    lines.push(`## Vector Search Indexes (${indexes.length})\n`);
    lines.push("These can be used for RAG applications with unstructured data.\n");
    lines.push("**How to use:** Connect via MCP server at `{workspace_host}/api/2.0/mcp/vector-search/{catalog}/{schema}` or\n");
    lines.push("`{workspace_host}/api/2.0/mcp/vector-search/{catalog}/{schema}/{index_name}`\n");
    for (const idx of indexes) {
      lines.push(`- \`${idx.name}\``);
      lines.push(`  - Endpoint: ${idx.endpoint}`);
      lines.push(`  - Status: ${idx.status}`);
    }
    lines.push("");
  }

  // Genie Spaces
  const spaces = results.genie_spaces;
  if (spaces.length > 0) {
    lines.push(`## Genie Spaces (${spaces.length})\n`);
    lines.push("**What they are:** Natural language interface to your data\n");
    lines.push("**How to use:** Connect via Genie MCP server at `{workspace_host}/api/2.0/mcp/genie/{space_id}`\n");
    for (const space of spaces) {
      lines.push(`- \`${space.name}\` (ID: ${space.id})`);
      if (space.description) {
        lines.push(`  - ${space.description}`);
      }
    }
    lines.push("");
  }

  // Custom MCP Servers (Databricks Apps)
  const customServers = results.custom_mcp_servers;
  if (customServers.length > 0) {
    lines.push(`## Custom MCP Servers (${customServers.length})\n`);
    lines.push("**What:** Your own MCP servers deployed as Databricks Apps (names starting with mcp-)\n");
    lines.push("**How to use:** Access via `{app_url}/mcp`\n");
    lines.push("**⚠️ Important:** Custom MCP server apps require manual permission grants:");
    lines.push("1. Get your agent app's service principal: `databricks apps get <agent-app> --output json | jq -r '.service_principal_name'`");
    lines.push("2. Grant permission: `databricks apps update-permissions <mcp-server-app> --service-principal <sp-name> --permission-level CAN_USE`");
    lines.push("(Apps are not yet supported as resource dependencies in databricks.yml)\n");
    for (const server of customServers) {
      lines.push(`- \`${server.name}\``);
      if (server.url) {
        lines.push(`  - URL: ${server.url}`);
      }
      if (server.status) {
        lines.push(`  - Status: ${server.status}`);
      }
      if (server.description) {
        lines.push(`  - ${server.description}`);
      }
    }
    lines.push("");
  }

  // External MCP Servers (UC Connections)
  const externalServers = results.external_mcp_servers;
  if (externalServers.length > 0) {
    lines.push(`## External MCP Servers (${externalServers.length})\n`);
    lines.push("**What:** Third-party MCP servers via Unity Catalog connections\n");
    lines.push("**How to use:** Connect via `{workspace_host}/api/2.0/mcp/external/{connection_name}`\n");
    lines.push("**Benefits:** Secure access to external APIs through UC governance\n");
    for (const server of externalServers) {
      lines.push(`- \`${server.name}\``);
      if (server.full_name) {
        lines.push(`  - Full name: ${server.full_name}`);
      }
      if (server.comment) {
        lines.push(`  - ${server.comment}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Main discovery function.
 */
async function main() {
  // Parse command-line arguments
  const args = process.argv.slice(2);
  let catalog: string | undefined;
  let schema: string | undefined;
  let format = "markdown";
  let output: string | undefined;
  let profile: string | undefined;
  let maxResults = DEFAULT_MAX_RESULTS;
  let maxSchemas = DEFAULT_MAX_SCHEMAS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--catalog" && i + 1 < args.length) {
      catalog = args[++i];
    } else if (arg === "--schema" && i + 1 < args.length) {
      schema = args[++i];
    } else if (arg === "--format" && i + 1 < args.length) {
      format = args[++i];
    } else if (arg === "--output" && i + 1 < args.length) {
      output = args[++i];
    } else if (arg === "--profile" && i + 1 < args.length) {
      profile = args[++i];
    } else if (arg === "--max-results" && i + 1 < args.length) {
      maxResults = parseInt(args[++i], 10);
    } else if (arg === "--max-schemas" && i + 1 < args.length) {
      maxSchemas = parseInt(args[++i], 10);
    }
  }

  if (schema && !catalog) {
    console.error("Error: --schema requires --catalog");
    process.exit(1);
  }

  console.error("Discovering available tools and data sources...");

  // Initialize Databricks workspace client
  const w = profile
    ? new WorkspaceClient({ profile })
    : new WorkspaceClient({
        host: process.env.DATABRICKS_HOST,
        authType: process.env.DATABRICKS_CONFIG_PROFILE ? "databricks-cli" : undefined,
        profile: process.env.DATABRICKS_CONFIG_PROFILE,
      });

  const results: DiscoveryResults = {
    uc_functions: [],
    uc_tables: [],
    vector_search_indexes: [],
    genie_spaces: [],
    custom_mcp_servers: [],
    external_mcp_servers: [],
  };

  // Discover each type with configurable limits
  console.error("- UC Functions...");
  results.uc_functions = (await discoverUCFunctions(w, catalog, maxSchemas)).slice(0, maxResults);

  console.error("- UC Tables...");
  results.uc_tables = (await discoverUCTables(w, catalog, schema, maxSchemas)).slice(0, maxResults);

  console.error("- Vector Search Indexes...");
  results.vector_search_indexes = (await discoverVectorSearchIndexes(w)).slice(0, maxResults);

  console.error("- Genie Spaces...");
  results.genie_spaces = (await discoverGenieSpaces(w)).slice(0, maxResults);

  console.error("- Custom MCP Servers (Apps)...");
  results.custom_mcp_servers = (await discoverCustomMCPServers(w)).slice(0, maxResults);

  console.error("- External MCP Servers (Connections)...");
  results.external_mcp_servers = (await discoverExternalMCPServers(w)).slice(0, maxResults);

  // Format output
  let outputText: string;
  if (format === "json") {
    outputText = JSON.stringify(results, null, 2);
  } else {
    outputText = formatOutputMarkdown(results);
  }

  // Write output
  if (output) {
    writeFileSync(output, outputText);
    console.error(`\nResults written to ${output}`);
  } else {
    console.log("\n" + outputText);
  }

  // Print summary
  console.error("\n=== Discovery Summary ===");
  console.error(`UC Functions: ${results.uc_functions.length}`);
  console.error(`UC Tables: ${results.uc_tables.length}`);
  console.error(`Vector Search Indexes: ${results.vector_search_indexes.length}`);
  console.error(`Genie Spaces: ${results.genie_spaces.length}`);
  console.error(`Custom MCP Servers: ${results.custom_mcp_servers.length}`);
  console.error(`External MCP Servers: ${results.external_mcp_servers.length}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
