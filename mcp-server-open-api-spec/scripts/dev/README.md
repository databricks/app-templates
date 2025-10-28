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

For local testing, use the integration test suite located in `tests/test_integration_server.py`:

```bash
DATABRICKS_CONFIG_PROFILE=<your-profile> \
UC_CONNECTION_NAME=<your-connection> \
SPEC_VOLUME_PATH=<your-volume-path> \
SPEC_FILE_NAME=<your-spec-file> \
uv run pytest tests/test_integration_server.py
```

The integration test will:
1. Automatically start the MCP server in the background
2. Test server health endpoint
3. Verify all MCP tools (list_api_endpoints, get_api_endpoint_schema, invoke_api_endpoint)
4. Validate tool responses and data structures
5. Automatically clean up and stop the server after tests

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

