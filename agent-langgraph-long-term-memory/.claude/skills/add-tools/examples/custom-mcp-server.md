# Custom MCP Server (Databricks App)

Custom MCP servers are Databricks Apps with names starting with `mcp-*`.

**Apps are not yet supported as resource dependencies in `databricks.yml`**, so manual permission grant is required.

## Steps

### 1. Add MCP server in `agent_server/agent.py`

```python
from databricks_langchain import DatabricksMCPServer, DatabricksMultiServerMCPClient

custom_mcp = DatabricksMCPServer(
    url="https://mcp-my-server.cloud.databricks.com/mcp",
    name="my custom mcp server",
)

mcp_client = DatabricksMultiServerMCPClient([custom_mcp])
tools = await mcp_client.get_tools()
```

### 2. Deploy your agent app first

```bash
databricks bundle deploy
databricks bundle run agent_langgraph_long_term_memory
```

### 3. Get your agent app's service principal

```bash
databricks apps get <your-agent-app-name> --output json | jq -r '.service_principal_name'
```

Example output: `sp-abc123-def456`

### 4. Grant permission on the MCP server app

```bash
databricks apps update-permissions <mcp-server-app-name> \
  --service-principal <agent-app-service-principal> \
  --permission-level CAN_USE
```

Example:
```bash
databricks apps update-permissions mcp-my-server \
  --service-principal sp-abc123-def456 \
  --permission-level CAN_USE
```

## Notes

- This manual step is required each time you connect to a new custom MCP server
- The permission grant persists across deployments
- If you redeploy the agent app with a new service principal, you'll need to grant permissions again
