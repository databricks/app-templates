"""MCP servers built by the agent. Never add free-form SQL servers.
Users could bypass confirm and write directly."""

from databricks_openai.agents import McpServer


def build_mcp_servers() -> list[McpServer]:
    """Return the agent's own MCP servers."""
    return []
