"""MCP servers to offer the agent — this is where you configure them.

Empty by default: the agent runs with no MCP servers. Add servers to ``build_mcp_servers`` to offer
them; ``agent/mason/mcp_runtime.py`` handles connecting them for each request.
"""

from agents.mcp import MCPServer


def build_mcp_servers() -> list[MCPServer]:
    """Return the MCP servers to offer the agent. Empty by default — add your own.

    Example (a Databricks-managed MCP, authed as the app service principal). ``McpServer`` from
    databricks-openai handles the OAuth and builds the URL; ``from_uc_function`` / ``from_vector_search``
    take Unity Catalog coordinates instead of a raw URL:

        from databricks_openai.agents import McpServer

        return [
            McpServer.from_uc_function(catalog="system", schema="ai"),
        ]
    """
    return []
