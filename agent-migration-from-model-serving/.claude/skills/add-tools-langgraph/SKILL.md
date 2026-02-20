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
from databricks_langchain import DatabricksMCPServer, DatabricksMultiServerMCPClient

genie_server = DatabricksMCPServer(
    url=f"{host}/api/2.0/mcp/genie/01234567-89ab-cdef",
    name="my genie space",
)

mcp_client = DatabricksMultiServerMCPClient([genie_server])
tools = await mcp_client.get_tools()
```

**Step 2:** Grant access in `databricks.yml`:
```yaml
resources:
  apps:
    agent_langgraph:
      resources:
        - name: 'my_genie_space'
          genie_space:
            name: 'My Genie Space'
            space_id: '01234567-89ab-cdef'
            permission: 'CAN_RUN'
```

**Step 3:** Deploy and run:
```bash
databricks bundle deploy
databricks bundle run agent_langgraph  # Required to start app with new code!
```

See **deploy** skill for more details.

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
| `lakebase.yaml` | Lakebase database | Agent memory storage |
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
  --json '{"access_control_list": [{"service_principal_name": "<agent-app-service-principal>", "permission_level": "CAN_USE"}]}'
```

See `examples/custom-mcp-server.md` for detailed steps.

## valueFrom Pattern (for app.yaml)

**IMPORTANT**: Make sure all `valueFrom` references in `app.yaml` reference an existing key in the `databricks.yml` file. 
Some resources need environment variables in your app. Use `valueFrom` in `app.yaml` to reference resources defined in `databricks.yml`:

```yaml
# app.yaml
env:
  - name: MLFLOW_EXPERIMENT_ID
    valueFrom: "experiment"        # References resources.apps.<app>.resources[name='experiment']
  - name: LAKEBASE_INSTANCE_NAME
    valueFrom: "database"   # References resources.apps.<app>.resources[name='database']
```

**Critical:** Every `valueFrom` value must match a `name` field in `databricks.yml` resources.

## Important Notes

- **MLflow experiment**: Already configured in template, no action needed
- **Multiple resources**: Add multiple entries under `resources:` list
- **Permission types vary**: Each resource type has specific permission values
- **Deploy + Run after changes**: Run both `databricks bundle deploy` AND `databricks bundle run agent_langgraph`
- **valueFrom matching**: Ensure `app.yaml` `valueFrom` values match `databricks.yml` resource `name` values
