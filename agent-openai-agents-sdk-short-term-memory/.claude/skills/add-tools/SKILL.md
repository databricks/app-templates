---
name: add-tools
description: "Add tools to your agent and grant required permissions in databricks.yml. Use when: (1) Adding MCP servers, Genie spaces, vector search, or UC functions to agent, (2) Permission errors at runtime, (3) User says 'add tool', 'connect to', 'grant permission', (4) Configuring databricks.yml resources."
---

# Add Tools & Grant Permissions

**After adding any MCP server to your agent, you MUST grant the app access in `databricks.yml`.**

Without this, you'll get permission errors when the agent tries to use the resource.

## Workflow

**Step 1:** Add MCP server in `agent_server/agent.py`:
```python
from databricks_openai.agents import McpServer

genie_server = McpServer(
    url=f"{host}/api/2.0/mcp/genie/01234567-89ab-cdef",
    name="my genie space",
)

agent = Agent(
    name="my agent",
    model="databricks-claude-3-7-sonnet",
    mcp_servers=[genie_server],
)
```

**Step 2:** Grant access in `databricks.yml`:
```yaml
resources:
  apps:
    agent_openai_agents_sdk:
      resources:
        - name: 'my_genie_space'
          genie_space:
            name: 'My Genie Space'
            space_id: '01234567-89ab-cdef'
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

## Important Notes

- **MLflow experiment**: Already configured in template, no action needed
- **Multiple resources**: Add multiple entries under `resources:` list
- **Permission types vary**: Each resource type has specific permission values
- **Deploy after changes**: Run `databricks bundle deploy` after modifying `databricks.yml`
