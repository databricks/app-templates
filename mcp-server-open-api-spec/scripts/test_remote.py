#!/usr/bin/env python3
"""
Test remote MCP server deployed as a Databricks App.

This script tests the remote MCP server with user-level OAuth authentication,
calling both the health tool and user authorization tool to verify functionality.

Usage:
    python test_remote.py --host <host> --token <token> --app-url <app-url>

Example:
    python test_remote.py \\
        --host https://dbc-a1b2345c-d6e7.cloud.databricks.com \\
        --token eyJr...Dkag \\
        --app-url https://dbc-a1b2345c-d6e7.cloud.databricks.com/serving-endpoints/my-app
"""

import argparse
import sys
import json

from databricks.sdk import WorkspaceClient
from databricks_mcp import DatabricksMCPClient


def main():
    parser = argparse.ArgumentParser(
        description="Test remote MCP server deployed as Databricks App"
    )

    parser.add_argument("--host", required=True, help="Databricks workspace URL")

    parser.add_argument("--token", required=True, help="OAuth access token")

    parser.add_argument("--app-url", required=True, help="Databricks App URL (without /mcp suffix)")

    args = parser.parse_args()

    print("=" * 70)
    print("Testing Remote MCP Server - Databricks App")
    print("=" * 70)
    print(f"\nWorkspace: {args.host}")
    print(f"App URL: {args.app_url}")
    print()

    try:
        # Create WorkspaceClient with OAuth token
        print("Step 1: Creating WorkspaceClient with OAuth token...")
        workspace_client = WorkspaceClient(host=args.host, token=args.token)
        print("✓ WorkspaceClient created successfully")
        print()

        # Create MCP client
        mcp_url = f"{args.app_url}/mcp"
        print(mcp_url)
        print(f"Step 2: Connecting to MCP server at {mcp_url}...")
        mcp_client = DatabricksMCPClient(server_url=mcp_url, workspace_client=workspace_client)
        print("✓ MCP client connected successfully")
        print()

        # List available tools
        print("Step 3: Listing available MCP tools...")
        print("-" * 70)
        tools = mcp_client.list_tools()
        print(tools)
        print("-" * 70)
        print(f"✓ Found {len(tools) if isinstance(tools, list) else 'N/A'} tools")
        print()

        print("Step 4: Calling tool: list_api_endpoints\n")
        
        endpoints_result = mcp_client.call_tool("list_api_endpoints")
        print(endpoints_result)
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
        
        return 0

    except Exception as e:
        print()
        print("=" * 70)
        print(f"✗ Error: {e}")
        print("=" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()