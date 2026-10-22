"""MCP tool loading — plumbing, slated to move into a Databricks SDK helper.

``mcp_tools`` builds a ``DatabricksMultiServerMCPClient`` from the servers in ``agent/mcps.py`` and
returns their tools (LangChain tools), which the agent appends to its local tools. You configure
*which* servers to offer in ``agent/mcps.py`` — this file only fetches their tools.
"""

import logging

from databricks_langchain import DatabricksMultiServerMCPClient

from agent.mcps import build_mcp_servers

logger = logging.getLogger(__name__)


async def mcp_tools() -> list:
    """Return the tools exposed by the configured MCP servers; empty list if none/on failure."""
    servers = build_mcp_servers()
    if not servers:
        return []
    try:
        return await DatabricksMultiServerMCPClient(servers).get_tools()
    except Exception:
        logger.warning("Failed to fetch MCP tools; continuing without them.", exc_info=True)
        return []
