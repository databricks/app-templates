---
name: add-tools
description: "Add tools to your agent and grant required permissions in databricks.yml. Use when: (1) Adding MCP servers, Genie spaces, vector search, or UC functions to agent, (2) Permission errors at runtime, (3) User says 'add tool', 'connect to', 'grant permission', (4) Configuring databricks.yml resources."
---

# Add Tools & Grant Permissions

> **Profile reminder:** All `databricks` CLI commands must include the profile from `.env`: `databricks <command> --profile <profile>`

> Don't have the resource yet? See **create-tools** skill first.

**After adding any MCP server to your agent, you MUST grant the app access in `databricks.yml`.**

Without this, you'll get permission errors when the agent tries to use the resource.

This template uses **Google ADK**. Databricks-hosted tools are connected with an ADK
`MCPToolset`, which needs the `mcp` package — run `uv add "google-adk[extensions]"` once.

## Workflow

**Step 1:** Add an MCP toolset in `agent_server/agent.py`:
```python
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
from agent_server.utils import get_bearer_token, get_databricks_host

def create_agent(workspace_client):
    host = get_databricks_host(workspace_client)
    token = get_bearer_token(workspace_client)
    genie = MCPToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=f"{host}/api/2.0/mcp/genie/01234567-89ab-cdef",
            headers={"Authorization": f"Bearer {token}"},
        ),
    )
    return LlmAgent(name="agent", model=build_model(workspace_client),
                    instruction="You are a helpful assistant.", tools=[get_current_time, genie])
```

Common Databricks MCP URL paths: UC functions `/api/2.0/mcp/functions/{catalog}/{schema}`,
Genie `/api/2.0/mcp/genie/{space_id}`, Vector Search `/api/2.0/mcp/vector-search/{catalog}/{schema}`,
code interpreter `/api/2.0/mcp/functions/system/ai`.

**Step 2:** Grant access in `databricks.yml`:
```yaml
resources:
  apps:
    agent_adk:
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
databricks bundle run agent_adk  # Required to start app with new code!
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
| `lakebase.yaml` | Lakebase database | Session/memory storage (provisioned) |
| `lakebase-autoscaling.yaml` | Lakebase autoscaling postgres | Session/memory storage (autoscaling) |
| `experiment.yaml` | MLflow experiment | Tracing (already configured) |
| `app.yaml` | Databricks App (app-to-app) | Custom MCP servers hosted as Apps |
| `custom-mcp-server.md` | Custom MCP apps | Apps starting with `mcp-*` |

## Custom MCP Servers (Databricks Apps)

Declare the target app as an `app` resource in `databricks.yml` — the bundle grants `CAN_USE` on deploy. Requires Databricks CLI **v0.298.0+**.

```yaml
resources:
  apps:
    agent_adk:
      resources:
        - name: 'mcp_server'
          app:
            name: 'mcp-my-server'
            permission: CAN_USE
```

See `examples/custom-mcp-server.md` for the full flow (agent code + YAML + deploy).

## value_from Pattern

**IMPORTANT**: Make sure all `value_from` references in `databricks.yml` `config.env` reference an existing key in the `databricks.yml` `resources` list.
Some resources need environment variables in your app. Use `value_from` in `databricks.yml` `config.env` to reference resources defined in `databricks.yml`:

```yaml
# In databricks.yml, under apps.<app>.config.env:
env:
  - name: MLFLOW_EXPERIMENT_ID
    value_from: "experiment"        # References resources.apps.<app>.resources[name='experiment']
  - name: LAKEBASE_INSTANCE_NAME
    value_from: "database"   # References resources.apps.<app>.resources[name='database']
```

**Critical:** Every `value_from` value must match a `name` field in `databricks.yml` resources.

## MCP Error Handling

MCP tool calls can fail (network issues, permission errors, timeouts). Give slow servers like
Genie a longer timeout, and wrap `runner.run_async(...)` in a try/except so one unavailable
server can't crash the request:

```python
MCPToolset(
    connection_params=StreamableHTTPConnectionParams(
        url=f"{host}/api/2.0/mcp/genie/{space_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=60.0,   # increase for slow tools like Genie
    ),
)
```

## Important Notes

- **MLflow experiment**: Already configured in template, no action needed
- **Multiple resources**: Add multiple entries under `resources:` list
- **Permission types vary**: Each resource type has specific permission values
- **Deploy + Run after changes**: Run both `databricks bundle deploy` AND `databricks bundle run agent_adk`
- **value_from matching**: Ensure `config.env` `value_from` values match `databricks.yml` resource `name` values
