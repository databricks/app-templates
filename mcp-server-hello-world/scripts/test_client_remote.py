"""
Test script for MCP server deployed as a Databricks App.
Tests the MCP client connection with Databricks authentication.

Usage:
    # Using Databricks CLI profile
    python test_client_remote.py --profile <profile-name> --app-url <app-url>

    # Using host and token
    python test_client_remote.py --host <host> --token <token> --app-url <app-url>
"""

import argparse
import sys

from databricks.sdk import WorkspaceClient
from databricks_mcp import DatabricksMCPClient


def main():
    parser = argparse.ArgumentParser(description="Test MCP server deployed as a Databricks App")

    # Authentication options
    auth_group = parser.add_mutually_exclusive_group(required=True)
    auth_group.add_argument("--profile", help="Databricks CLI profile name (e.g., DEFAULT, PROD)")
    auth_group.add_argument("--host", help="Databricks workspace URL (requires --token)")

    parser.add_argument("--token", help="Databricks personal access token (requires --host)")

    parser.add_argument("--app-url", required=True, help="Databricks App MCP endpoint URL")

    args = parser.parse_args()

    # Validate host/token combination
    if args.host and not args.token:
        parser.error("--token is required when using --host")
    if args.token and not args.host:
        parser.error("--host is required when using --token")

    # Create WorkspaceClient based on authentication method
    if args.profile:
        print(f"Authenticating with profile: {args.profile}")
        workspace_client = WorkspaceClient(profile=args.profile)
    else:
        print(f"Authenticating with host: {args.host}")
        workspace_client = WorkspaceClient(host=args.host, token=args.token)

    mcp_url = args.app_url + "/mcp"
    print(f"Connecting to MCP server: {mcp_url}")
    print()

    # Connect to remote MCP server with authentication
    try:
        mcp_client = DatabricksMCPClient(server_url=mcp_url, workspace_client=workspace_client)

        # List available tools
        print("Available MCP Tools:")
        print("=" * 50)
        tools = mcp_client.list_tools()
        print(tools)
        print("=" * 50)
        print(
            f"✓ Successfully connected! Found {len(tools) if isinstance(tools, list) else 'N/A'} tools"
        )

        # Test the health tool
        print()
        print("=" * 50)
        print("Testing 'health' tool:")
        print("=" * 50)
        try:
            health_result = mcp_client.call_tool("health")
            print(health_result)
            print("=" * 50)
            print("✓ Health check passed!")
        except Exception as e:
            print(f"❌ Error calling health tool: {e}")

    except Exception as e:
        print(f"❌ Error connecting to MCP server: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
