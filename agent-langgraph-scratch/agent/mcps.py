"""MCP servers to offer the agent — this is where you configure them.

Empty by default: the agent runs with no MCP servers. Add servers to ``build_mcp_servers`` to offer
them; ``agent/mason/mcp_runtime.py`` turns them into tools for each request.
"""

from databricks_langchain import DatabricksMCPServer


def build_mcp_servers() -> list[DatabricksMCPServer]:
    """Return the MCP servers to offer the agent. Empty by default — add your own.

    Example (a Databricks-managed MCP, authed as the app service principal)::

        from databricks.sdk import WorkspaceClient

        host = WorkspaceClient().config.host
        return [
            DatabricksMCPServer(
                name="system-ai",
                url=f"{host}/api/2.0/mcp/functions/system/ai",
                workspace_client=WorkspaceClient(),
            ),
        ]
    """
    return []
