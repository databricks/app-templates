#!/usr/bin/env python3
"""Test script for the MCP server running locally"""

import json
import sys

from databricks_mcp import DatabricksMCPClient


def print_section(title: str):
    """Print a formatted section header"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")


def pretty_print_json(data, indent=2):
    """Pretty print JSON data"""
    print(json.dumps(data, indent=indent, sort_keys=False))


def main():
    print("🔌 Connecting to local MCP server...")
    
    try:
        # 7. Connect to local MCP server
        mcp_client = DatabricksMCPClient(server_url="http://0.0.0.0:8000/mcp")
        print("✅ Connected successfully!\n")
        
        # 8. List all available tools
        print_section("Available MCP Tools")
        tools = mcp_client.list_tools()
        
        if tools:
            print(tools)
        else:
            print("No tools found.")
        
        # 9. Call list_api_endpoints tool
        print_section("API Endpoints from Remote Server")
        print("Calling tool: list_api_endpoints\n")
        
        endpoints_result = mcp_client.call_tool("list_api_endpoints")
        
        # Handle CallToolResult object
        endpoints_data = None
        if hasattr(endpoints_result, 'structuredContent') and endpoints_result.structuredContent:
            # Use structured content if available
            endpoints_data = endpoints_result.structuredContent
        elif hasattr(endpoints_result, 'content') and endpoints_result.content:
            # Fall back to parsing text from content
            for content_item in endpoints_result.content:
                if hasattr(content_item, 'text'):
                    try:
                        endpoints_data = json.loads(content_item.text)
                        break
                    except json.JSONDecodeError:
                        print(f"Failed to parse JSON from content: {content_item.text}")
        
        if endpoints_data:
            pretty_print_json(endpoints_data)
        else:
            print("❌ No results returned from list_api_endpoints tool")
        
        print("\n✅ Test completed successfully!")
        return 0
        
    except Exception as e:
        print(f"\n❌ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())