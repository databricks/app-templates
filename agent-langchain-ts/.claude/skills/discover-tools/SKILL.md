---
name: discover-tools
description: "Discover available tools and resources in Databricks workspace. Use when: (1) User asks 'what tools are available', (2) Before writing agent code, (3) Looking for MCP servers, Genie spaces, UC functions, or vector search indexes, (4) User says 'discover', 'find resources', or 'what can I connect to'."
---

# Discover Available Tools

**Run tool discovery BEFORE writing agent code** to understand what resources are available in the workspace.

## Run Discovery

```bash
npm run discover-tools
```

**Options:**
```bash
# Limit to specific catalog/schema
npm run discover-tools -- --catalog my_catalog --schema my_schema

# Output as JSON
npm run discover-tools -- --format json --output tools.json

# Save markdown report
npm run discover-tools -- --output tools.md

# Use specific Databricks profile
npm run discover-tools -- --profile DEFAULT
```

## What Gets Discovered

| Resource Type | Description | MCP URL Pattern |
|--------------|-------------|-----------------|
| **UC Functions** | SQL UDFs as agent tools | `{host}/api/2.0/mcp/functions/{catalog}/{schema}` |
| **UC Tables** | Structured data for querying | (via UC functions) |
| **Vector Search Indexes** | RAG applications | `{host}/api/2.0/mcp/vector-search/{catalog}/{schema}` |
| **Genie Spaces** | Natural language data interface | `{host}/api/2.0/mcp/genie/{space_id}` |
| **Custom MCP Servers** | Apps starting with `mcp-*` | `{app_url}/mcp` |
| **External MCP Servers** | Via UC connections | `{host}/api/2.0/mcp/external/{connection_name}` |

## Using Discovered Tools in Code

After discovering tools, add them to your agent in `src/mcp-servers.ts`:

```typescript
import { DatabricksMCPServer } from "@databricks/langchainjs";

export function getMCPServers(): DatabricksMCPServer[] {
  return [
    // Example: Add a Genie space
    DatabricksMCPServer.fromGenieSpace("01f1037ebc531bbdb27b875271b31bf4"),

    // Example: Add Databricks SQL
    new DatabricksMCPServer({
      name: "dbsql",
      path: "/api/2.0/mcp/sql",
    }),

    // Example: Add UC functions from a schema
    DatabricksMCPServer.fromUCFunction("my_catalog", "my_schema"),

    // Example: Add vector search
    DatabricksMCPServer.fromVectorSearch(
      "my_catalog",
      "my_schema",
      "my_index"
    ),
  ];
}
```

## Next Steps

After adding MCP servers to your agent:
1. **Grant permissions** in `databricks.yml` (see **add-tools** skill)
2. Test locally with `npm run dev` (see **run-locally** skill)
3. Deploy with `databricks bundle deploy` (see **deploy** skill)
