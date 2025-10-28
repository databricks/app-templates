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
./scripts/dev/start_server.sh
```

The server will run on:
- Main app: `http://0.0.0.0:8000`
- Health check: `http://0.0.0.0:8000/health`
- MCP endpoint: `http://0.0.0.0:8000/mcp`

**Note:** Make sure you have the required environment variables set:
- `DATABRICKS_CONFIG_PROFILE` (for authentication)
- `UC_CONNECTION_NAME` (for Unity Catalog connection)
- `SPEC_VOLUME_PATH` (path to OpenAPI spec in Databricks volume)
- `SPEC_FILE_NAME` (name of the spec file, e.g., `spec.json`)

## Local Testing

### `query_local.sh`

A bash script to test the MCP server locally. It will:

1. Prompt for Databricks Profile (for authentication)
2. Prompt for UC Connection Name
3. Prompt for Spec Volume Path (format: `/Volumes/<catalog>/<schema>/<volume>`)
4. Prompt for Spec File Name (e.g., `spec.json`)
5. Set up environment variables (`DATABRICKS_CONFIG_PROFILE`, `UC_CONNECTION_NAME`, `SPEC_VOLUME_PATH`, `SPEC_FILE_NAME`)
6. Run `uv sync` to install dependencies
7. Start the MCP server in the background
8. Wait for the server to be ready
9. Run the Python test script
10. Automatically clean up and stop the server

**Usage:**

```bash
./scripts/dev/query_local.sh
```

### `query_local.py`

A Python test script that:

1. Connects to the local MCP server at `http://0.0.0.0:8000/mcp`
2. Lists all available MCP tools
3. Calls the `list_api_endpoints` tool to fetch endpoints from the remote API
4. Pretty prints the results

This script is automatically called by `query_local.sh`.

**Manual Usage:**

```bash
# Make sure the server is running first
uv run python scripts/dev/query_local.py
```

## Remote Testing

### `query_remote.sh`

A bash script to test a deployed MCP server on Databricks Apps. It will:

1. Prompt for Databricks Profile name
2. Prompt for Databricks App name
3. Get app information and extract scopes
4. Extract app URL
5. Get workspace host from profile
6. Generate OAuth token using `generate_oauth_token.py`
7. Run the Python remote test script with the generated token
8. Display test results

**Usage:**

```bash
./scripts/dev/query_remote.sh
```

**What you'll need:**
- A deployed Databricks App with your MCP server
- Databricks CLI configured with the appropriate profile
- The app name in Databricks

### `query_remote.py`

A Python test script that:

1. Creates a WorkspaceClient with OAuth token
2. Connects to the remote MCP server at `<app-url>/mcp`
3. Lists all available MCP tools
4. Calls the `list_api_endpoints` tool to verify functionality
5. Pretty prints the results

This script is automatically called by `query_remote.sh` with the appropriate parameters.

**Manual Usage:**

```bash
# You'll need to provide host, token, and app URL
uv run python scripts/dev/query_remote.py \
    --host https://your-workspace.cloud.databricks.com \
    --token <oauth-token> \
    --app-url https://your-app-url.databricksapps.com
```

## Other Scripts

### `generate_oauth_token.py`

Script for generating OAuth tokens for Databricks authentication.

