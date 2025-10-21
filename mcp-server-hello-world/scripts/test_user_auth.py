#!/usr/bin/env python3
"""
Test user authorization with a deployed Databricks App.

This script tests the MCP server with user-level OAuth authentication,
simulating how end users would interact with the deployed app.

Usage:
    python test_user_auth.py --host <host> --token <token> --app-url <app-url>

Example:
    python test_user_auth.py \\
        --host https://dbc-a1b2345c-d6e7.cloud.databricks.com \\
        --token eyJr...Dkag \\
        --app-url https://dbc-a1b2345c-d6e7.cloud.databricks.com/serving-endpoints/my-app
"""

import argparse
import sys

from databricks.sdk import WorkspaceClient
from databricks_mcp import DatabricksMCPClient


def main():
    parser = argparse.ArgumentParser(
        description="Test user authorization with deployed Databricks App"
    )

    parser.add_argument("--host", required=True, help="Databricks workspace URL")

    parser.add_argument("--token", required=True, help="OAuth access token")

    parser.add_argument("--app-url", required=True, help="Databricks App URL (without /mcp suffix)")

    args = parser.parse_args()

    print("=" * 70)
    print("Testing User Authorization with Databricks App")
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

        # Call get_current_user tool
        print("Step 4: Calling 'get_current_user' tool...")
        print("-" * 70)
        user_result = mcp_client.call_tool("get_current_user")
        print(user_result)
        print("-" * 70)
        print("✓ Successfully retrieved current user information")
        print()

        print("=" * 70)
        print("✓ All Tests Passed!")
        print("=" * 70)

    except Exception as e:
        print()
        print("=" * 70)
        print(f"✗ Error: {e}")
        print("=" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()
