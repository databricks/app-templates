---
name: add-tools
description: "Add tools to your agent and grant required permissions in databricks.yml. Use when: (1) Adding MCP servers, Genie spaces, vector search, or UC functions to agent, (2) Permission errors at runtime, (3) User says 'add tool', 'connect to', 'grant permission', (4) Configuring databricks.yml resources."
---

# Add Tools & Grant Permissions

**After adding any MCP server to your agent, you MUST grant the app access in `databricks.yml`.**

Without this, you'll get permission errors when the agent tries to use the resource.

## Workflow

**Step 1:** Add MCP server in `src/mcp-servers.ts`:
```typescript
import { DatabricksMCPServer } from "@databricks/langchainjs";

export function getMCPServers(): DatabricksMCPServer[] {
  return [
    // Formula 1 Genie Space
    DatabricksMCPServer.fromGenieSpace("01f1037ebc531bbdb27b875271b31bf4"),

    // Add more MCP servers here...
  ];
}
```

**Step 2:** Grant access in `databricks.yml`:
```yaml
resources:
  apps:
    agent_langchain_ts:
      resources:
        - name: 'f1_genie_space'
          genie_space:
            name: 'Formula 1 Race Analytics'
            space_id: '01f1037ebc531bbdb27b875271b31bf4'
            permission: 'CAN_RUN'
```

**Step 3:** Deploy with `databricks bundle deploy` (see **deploy** skill)

## Resource Type Examples

See the `examples/` directory for complete YAML snippets:

| File | Resource Type | When to Use |
|------|--------------|-------------|
| `uc-function.yaml` | Unity Catalog function | UC functions via MCP |
| `uc-connection.yaml` | UC connection | External MCP servers |
| `vector-search.yaml` | Vector search index | RAG applications |
| `sql-warehouse.yaml` | SQL warehouse | SQL execution |
| `serving-endpoint.yaml` | Model serving endpoint | Model inference |
| `genie-space.yaml` | Genie space | Natural language data |
| `experiment.yaml` | MLflow experiment | Tracing (already configured) |
| `custom-mcp-server.md` | Custom MCP apps | Apps starting with `mcp-*` |

## Custom MCP Servers (Databricks Apps)

Apps are **not yet supported** as resource dependencies in `databricks.yml`. Manual permission grant required:

**Step 1:** Get your agent app's service principal:
```bash
databricks apps get <your-agent-app-name> --output json | jq -r '.service_principal_name'
```

**Step 2:** Grant permission on the MCP server app:
```bash
databricks apps update-permissions <mcp-server-app-name> \
  --service-principal <agent-app-service-principal> \
  --permission-level CAN_USE
```

See `examples/custom-mcp-server.md` for detailed steps.

## TypeScript-Specific Patterns

### Adding Multiple MCP Servers

Edit `src/mcp-servers.ts`:
```typescript
export function getMCPServers(): DatabricksMCPServer[] {
  const servers: DatabricksMCPServer[] = [];

  // Genie Space
  servers.push(
    DatabricksMCPServer.fromGenieSpace("01f1037ebc531bbdb27b875271b31bf4")
  );

  // SQL MCP
  servers.push(
    new DatabricksMCPServer({
      name: "dbsql",
      path: "/api/2.0/mcp/sql",
    })
  );

  // UC Functions
  servers.push(
    DatabricksMCPServer.fromUCFunction("main", "default")
  );

  // Vector Search
  servers.push(
    DatabricksMCPServer.fromVectorSearch("main", "default", "my_index")
  );

  return servers;
}
```

### LangChain Agent Pattern

The agent uses standard LangChain.js APIs with a manual agentic loop for tool execution:
```typescript
// In src/agent.ts - uses standard LangChain.js pattern
export async function createAgent(config: AgentConfig = {}) {
  // Load tools (basic + MCP if configured)
  const tools = await getAllTools(config.mcpServers);

  // Bind tools to model using standard LangChain API
  const modelWithTools = model.bindTools(tools);

  // Manual agentic loop: invoke model, execute tools, add ToolMessages, repeat
  // This pattern works with both basic tools and MCP tools
}
```

## MCP Tool Types

| Tool Type | Use Case | MCP URL Pattern |
|-----------|----------|-----------------|
| **Databricks SQL** | Execute SQL queries on Unity Catalog tables | `/api/2.0/mcp/sql` |
| **UC Functions** | Call Unity Catalog functions as tools | `/api/2.0/mcp/functions/{catalog}/{schema}` |
| **Vector Search** | Semantic search over embeddings for RAG | `/api/2.0/mcp/vector-search/{catalog}/{schema}/{index}` |
| **Genie Spaces** | Natural language data queries | `/api/2.0/mcp/genie/{space_id}` |

## Troubleshooting

### "Permission denied" errors

Check `databricks.yml` has all required resource permissions:
```bash
databricks bundle validate
databricks bundle deploy
```

### "Tool not found in agent"

1. Verify `src/mcp-servers.ts` configuration
2. Restart local server: `npm run dev:agent`
3. Check agent logs for "Loaded X MCP tools" message

### "MCP tools not working"

See `mcp-known-issues.md` and `mcp-best-practices.md` in this directory for:
- Known limitations and workarounds
- LangChain.js manual agentic loop pattern
- MCP tool integration best practices

## Additional Resources

- **`mcp-known-issues.md`** - Known MCP integration issues and status
- **`mcp-best-practices.md`** - Correct implementation patterns for MCP tools
- **`examples/`** - YAML configuration examples for all resource types

## Important Notes

- **MLflow experiment**: Already configured in template, no action needed
- **Multiple resources**: Add multiple entries under `resources:` list
- **Permission types vary**: Each resource type has specific permission values
- **Deploy after changes**: Run `databricks bundle deploy` after modifying `databricks.yml`
- **Genie spaces**: Use `CAN_RUN` permission for Genie spaces
- **Service principal**: Deployed apps run as service principals and need explicit resource grants
