"""
Test script for MCP server running locally.
Tests the MCP client connection without authentication.
"""

from databricks_mcp import DatabricksMCPClient

# Connect to local MCP server
mcp_client = DatabricksMCPClient(server_url="http://0.0.0.0:8000/mcp")

# List available tools
print("Available MCP Tools:")
print("=" * 50)
tools = mcp_client.list_tools()
print(tools)
print("=" * 50)
print(f"✓ Successfully connected! Found {len(tools) if isinstance(tools, list) else 'N/A'} tools")
print()

# Test the health tool
print("Testing 'health' tool:")
print("=" * 50)
try:
    health_result = mcp_client.call_tool("health")
    print(health_result)
    print("=" * 50)
    print("✓ Health check passed!")

    # TODO: Add new tool tests here
    # Example:
    # try:
    #     result = mcp_client.call_tool("your_new_tool", param1="value")
    #     print(result)
    #     print("-" * 70)
    #     print("✓ your_new_tool test passed!")
    # except Exception as e:
    #     print(f"✗ Error calling your_new_tool: {e}")
    #     print("-" * 70)
    # print()
except Exception as e:
    print(f"❌ Error calling health tool: {e}")
