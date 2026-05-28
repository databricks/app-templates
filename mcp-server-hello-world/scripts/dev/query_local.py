"""
Minimal example showing how to interact with an MCP server using Python.

This script demonstrates:
1. Listing available tools
2. Calling a specific tool

Requirements:
  pip install mcp
"""

import asyncio
import json
from typing import Any, List

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.types import CallToolResult, Tool

# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

SERVER_URL = "http://localhost:8000/mcp"  # Update to your MCP server URL


# ---------------------------------------------------------------------
# MCP helpers
# ---------------------------------------------------------------------


async def list_tools() -> List[Tool]:
    """
    Fetch and return the list of tools exposed by the MCP server.
    """
    async with streamablehttp_client(url=SERVER_URL) as (
        read_stream,
        write_stream,
        _,
    ):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            return (await session.list_tools()).tools


async def call_tool(
    tool_name: str,
    arguments: dict[str, Any] | None = None,
) -> CallToolResult:
    """
    Call a tool by name with optional arguments.
    """
    async with streamablehttp_client(url=SERVER_URL) as (
        read_stream,
        write_stream,
        _,
    ):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            return await session.call_tool(tool_name, arguments)


# ---------------------------------------------------------------------
# Example usage
# ---------------------------------------------------------------------


async def main():
    print(f"Connecting to MCP server at {SERVER_URL} ...")
    # List available tools
    tools = await list_tools()
    print(f"{len(tools)} tools found")
    SEP = "-" * 80
    for tool in tools:
        output = f"""
TOOL: {tool.name}
{SEP}
Description:
{tool.description.strip()}

{SEP}
Input Schema:
{json.dumps(tool.inputSchema, indent=2)}

{SEP}
Output Schema:
{json.dumps(tool.outputSchema, indent=2)}
{SEP}
{SEP}
""".strip()
        print(output)

    # Example: call a tool
    # Uncomment and update as needed
    #
    # result = await call_tool(
    #     tool_name="health",      # Replace with the desired tool name
    #     arguments={},            # Replace with the desired arguments
    # )
    #
    # print("\nTool result:")
    # print(result)


def run_locally():
    asyncio.run(main())

if __name__ == "__main__":
    run_locally()
