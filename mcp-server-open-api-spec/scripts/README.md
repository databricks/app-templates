# Scripts

This directory contains helper scripts for the MCP Server.

## Server Management

### `start_server.sh`

A simple bash script to start the MCP server locally.

**What it does:**
1. Runs `uv sync` to ensure dependencies are installed
2. Starts the server with `uv run custom-open-api-spec-server`

**Usage:**

```bash
./scripts/start_server.sh
```

The server will run on:
- Main app: `http://0.0.0.0:8000`
- Health check: `http://0.0.0.0:8000/health`
- MCP endpoint: `http://0.0.0.0:8000/mcp`

**Note:** Make sure you have the required environment variables set:
- `DATABRICKS_CONFIG_PROFILE` (for authentication)
- `UC_CONNECTION_NAME` (for Unity Catalog connection)
- `SPEC_VOLUME_PATH` (path to OpenAPI spec in Databricks volume)

## Local Testing

### `test_local.sh`

A bash script to test the MCP server locally. It will:

1. Prompt for Databricks Profile (for authentication)
2. Prompt for UC Connection Name
3. Prompt for Spec Volume Path (format: `/Volumes/<catalog>/<schema>/<volume>`)
4. Set up environment variables (`DATABRICKS_CONFIG_PROFILE`, `UC_CONNECTION_NAME`, `SPEC_VOLUME_PATH`)
5. Run `uv sync` to install dependencies
6. Start the MCP server in the background
7. Wait for the server to be ready
8. Run the Python test script
9. Automatically clean up and stop the server

**Usage:**

```bash
./scripts/test_local.sh
```

### `test_local.py`

A Python test script that:

1. Connects to the local MCP server at `http://0.0.0.0:8000/mcp`
2. Lists all available MCP tools
3. Calls the `list_api_endpoints` tool to fetch endpoints from the remote API
4. Pretty prints the results

This script is automatically called by `test_local.sh`.

**Manual Usage:**

```bash
# Make sure the server is running first
uv run python scripts/test_local.py
```

## Other Scripts

### `generate_oauth_token.py`

Script for generating OAuth tokens for Databricks authentication.

