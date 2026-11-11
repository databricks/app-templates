# Custom MCP Server (Databricks App)

Custom MCP servers are Databricks Apps with names starting with `mcp-*`.

Declare the target app as an `app` resource in `databricks.yml` and the bundle will grant `CAN_USE` on deploy. Requires Databricks CLI **v0.298.0+**.

## Steps

### 1. Install the MCP extra

ADK's `MCPToolset` needs the `mcp` package:

```bash
uv add "google-adk[mcp]"
```

### 2. Add the MCP toolset in `agent_server/agent.py`

Find the server's URL with `databricks apps get mcp-my-server` (the `url` field) and append `/mcp`.

```python
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset

from agent_server.utils import get_bearer_token

CUSTOM_MCP_URL = "https://mcp-my-server-1234567890.aws.databricksapps.com/mcp"


def create_agent(workspace_client: WorkspaceClient) -> LlmAgent:
    token = get_bearer_token(workspace_client)
    custom_mcp = MCPToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=CUSTOM_MCP_URL,
            headers={"Authorization": f"Bearer {token}"},
        ),
    )
    return LlmAgent(
        name=AGENT_NAME,
        model=build_model(workspace_client),
        instruction="You are a helpful assistant.",
        tools=[get_current_time, custom_mcp],
    )
```

### 3. Grant access in `databricks.yml`

Add the target app as a resource:

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

### 4. Deploy

```bash
databricks bundle deploy
databricks bundle run agent_adk
```

The bundle grants `CAN_USE` on the target app automatically — no manual permission steps needed.

## Notes

- Requires CLI v0.298.0+ (earlier versions will warn `unknown field: name` on `app.name`)
- The only supported permission is `CAN_USE`
- Subsequent `databricks bundle deploy` commands preserve the `app` resource
- Locally, `get_bearer_token` uses your CLI profile, so your user needs `CAN_USE` on the MCP app too
