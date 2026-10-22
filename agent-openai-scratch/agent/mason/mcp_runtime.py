"""MCP connection lifecycle — plumbing, slated to move into a Databricks SDK helper.

``connect`` opens the servers from ``build_mcp_servers`` for the duration of a request via the SDK's
``MCPServerManager`` (connects on enter, cleans up on exit, drops any that fail); the agent calls
their tools over those live connections until the run finishes. You configure *which* servers to
offer in ``agent/mcps.py`` — this file only manages connecting them.
"""

from contextlib import AsyncExitStack

from agents.mcp import MCPServer, MCPServerManager

from agent.mcps import build_mcp_servers


async def connect(stack: AsyncExitStack) -> list[MCPServer]:
    """Open the configured MCP servers for this request; returns the connected ones.

    No servers configured -> empty list. The ``MCPServerManager`` connects them on enter and cleans
    them up when ``stack`` exits at the end of the request.
    """
    servers = build_mcp_servers()
    if not servers:
        return []
    manager = await stack.enter_async_context(MCPServerManager(servers))
    return manager.active_servers
