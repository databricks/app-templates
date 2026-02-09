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

### Automatic AgentMCP Pattern

The agent automatically uses the manual agentic loop (AgentMCP) when MCP servers are configured:
```typescript
// In src/agent.ts - happens automatically
if (config.mcpServers && config.mcpServers.length > 0) {
  console.log("✅ Using AgentMCP (manual agentic loop) for MCP tools");
  return AgentMCP.create({...});
}
```

## Important Notes

- **MLflow experiment**: Already configured in template, no action needed
- **Multiple resources**: Add multiple entries under `resources:` list
- **Permission types vary**: Each resource type has specific permission values
- **Deploy after changes**: Run `databricks bundle deploy` after modifying `databricks.yml`
- **Genie spaces**: Use `CAN_RUN` permission for Genie spaces
- **Service principal**: Deployed apps run as service principals and need explicit resource grants
