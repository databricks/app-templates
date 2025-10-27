# Claude.md - MCP Server Hello World

This file provides context about this project for AI assistants like Claude.

## Project Overview

This is a **Model Context Protocol (MCP) server** template built with FastMCP and FastAPI, designed to run as a Databricks App. MCP enables AI assistants to discover and invoke tools/functions exposed by servers.

**Key Concepts:**
- **MCP Server**: Exposes tools via the Model Context Protocol over HTTP
- **Tools**: Python functions decorated with `@mcp_server.tool` that AI assistants can call
- **Databricks Apps**: The deployment platform where this server runs in production
- **Local Development**: Server runs on `localhost:8000` for testing before deployment

## Project Structure

```
server/              # Core MCP server code
├── app.py          # FastAPI + FastMCP setup, middleware
├── main.py         # Entry point (uvicorn runner)
├── tools.py        # MCP tool definitions (add new tools here)
└── utils.py        # Databricks auth helpers (workspace client factory)

scripts/            # Developer utilities
└── dev/
    ├── start_server.sh         # Start the MCP server locally
    ├── query_remote.sh         # Interactive remote deployment test with OAuth
    ├── query_remote.py         # Test deployed MCP server with health + user auth
    └── generate_oauth_token.py # Generate OAuth tokens for Databricks

tests/              # Integration tests
└── test_integration_server.py # Server integration tests with pytest

pyproject.toml      # Dependencies, build config, CLI command definition
app.yaml            # Databricks Apps deployment config
```

## Key Files Explained

### `server/app.py`
- Creates FastMCP instance with SSE transport
- Middleware to store request headers in context (for user auth token)
- Mounts MCP at `/mcp` endpoint
- Imports tools from `tools.py`

### `server/tools.py`
- **This is where you add new MCP tools**
- Each tool is a Python function with `@mcp_server.tool` decorator
- Tools must have clear docstrings (AI uses these to understand when to call them)
- Type hints are important for validation
- Return dicts or Pydantic models for structured data
- **Current tools:**
  - `health`: Simple health check for monitoring
  - `get_current_user`: Returns authenticated user information (display_name, user_name, active status)

### `server/utils.py`
- `get_workspace_client()`: Returns WorkspaceClient with app service principal auth (when deployed) or developer auth (local)
- `get_user_authenticated_workspace_client()`: Returns WorkspaceClient with end-user auth (when deployed) or developer auth (local)
- Uses `DATABRICKS_APP_NAME` env var to detect if running in Databricks Apps
- Retrieves user token from `x-forwarded-access-token` header (set by Databricks Apps)

### `server/main.py`
- Entry point that runs uvicorn server
- Configured via `[project.scripts]` in `pyproject.toml` as `custom-mcp-server` command
- Accepts `--port` argument to customize server port (default: 8000)

## Authentication & Environment Detection

### Local Development
- Both `get_workspace_client()` and `get_user_authenticated_workspace_client()` return `WorkspaceClient()` 
- Uses default Databricks CLI authentication (from `~/.databrickscfg`)
- No `DATABRICKS_APP_NAME` environment variable present

### Deployed as Databricks App
- `DATABRICKS_APP_NAME` environment variable is set
- `get_workspace_client()`: Authenticates as app service principal
- `get_user_authenticated_workspace_client()`: 
  - Requires `x-forwarded-access-token` header
  - Authenticates as the end user
  - Raises error if token missing

## Common Development Tasks

### Adding a New Tool

1. Open `server/tools.py`
2. Add function inside `load_tools()`:

```python
@mcp_server.tool
def your_tool_name(param1: str, param2: int) -> dict:
    """
    Clear description of what this tool does.
    
    Args:
        param1: Description of first parameter
        param2: Description of second parameter
    
    Returns:
        dict: Description of return value
    """
    # Implementation
    return {"result": "value"}
```

3. Restart server - tool is automatically available

### Using Databricks SDK in Tools

```python
from server import utils

@mcp_server.tool
def list_clusters() -> dict:
    """List Databricks clusters."""
    w = utils.get_workspace_client()  # App auth
    clusters = w.clusters.list()
    return {"clusters": [c.cluster_name for c in clusters]}

@mcp_server.tool
def get_current_user() -> dict:
    """Get current user information."""
    try:
        w = utils.get_user_authenticated_workspace_client()  # User auth
        user = w.current_user.me()
        return {
            "display_name": user.display_name,
            "user_name": user.user_name,
            "active": user.active,
        }
    except Exception as e:
        return {"error": str(e), "message": "Failed to retrieve user information"}
```

**Note:** The `get_current_user` tool is already implemented in `server/tools.py` and serves as a real example.

### Development Workflow

**Run integration tests:**
```bash
# Run all tests
pytest tests/

# Run with verbose output
pytest tests/ -v

# Run specific test
pytest tests/test_integration_server.py::test_call_tools
```

**Start server for development:**
```bash
# Using convenience script (port 8000)
./scripts/dev/start_server.sh

# Or directly with uv (default port 8000)
uv run custom-mcp-server

# Or with custom port
uv run custom-mcp-server --port 8080

# Server runs in foreground, Ctrl+C to stop
```

**Test remote deployment:**
```bash
./scripts/dev/query_remote.sh
# Follow interactive prompts
```

## Dependencies

- **fastmcp**: MCP server framework
- **fastapi**: Web framework
- **uvicorn**: ASGI server
- **databricks-sdk**: Databricks API client
- **databricks-mcp**: Databricks MCP client (dev only, for testing)
- **pydantic**: Data validation
- **pytest**: Testing framework (dev only, for integration tests)

## Important Notes for AI Assistants

1. **Never modify `server/app.py` middleware** - The header_store context is critical for user authentication
2. **Always add tools in `server/tools.py`** - Don't create new tool files without discussing
3. **Type hints are mandatory** - FastMCP uses them for validation
4. **Docstrings are critical** - AI assistants read them to understand when to call tools
5. **Return structured data** - Use dicts or Pydantic models, not plain strings
6. **Handle errors gracefully** - Wrap Databricks SDK calls in try-except
7. **Don't commit `.databrickscfg`** - It contains secrets
8. **The `/mcp` endpoint is fixed** - MCP protocol requires this path
9. **Run integration tests** - Always run `pytest tests/` after adding/modifying tools
10. **Integration tests call all tools** - The `test_call_tools` test automatically discovers and calls every registered tool

## Common Patterns

### Error Handling in Tools
```python
@mcp_server.tool
def safe_tool() -> dict:
    """Tool with proper error handling."""
    try:
        result = some_operation()
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}
```

### Using Both Auth Methods
```python
from server import utils

# For operations that need app-level permissions (service principal)
app_client = utils.get_workspace_client()
clusters = app_client.clusters.list()

# For operations on behalf of the user (user authentication)
user_client = utils.get_user_authenticated_workspace_client()
current_user = user_client.current_user.me()
```

**Real-world example:** See `get_current_user` tool in `server/tools.py` which uses user authentication to retrieve the current user's information.

## MCP Protocol Basics

- **Tools**: Functions the AI can call
- **Resources**: Static or dynamic data the AI can read (not used in this template)
- **Prompts**: Reusable prompt templates (not used in this template)

This template focuses on **tools** as the primary MCP primitive.

## Deployment

- Deploy to Databricks Apps via CLI or UI
- App automatically gets a service principal identity
- User authentication requires app to request scopes during creation
- MCP endpoint: `https://<workspace>/serving-endpoints/<app-name>/mcp`

### Testing in AI Playground

After deployment, the MCP server can be tested interactively in Databricks AI Playground:

1. Navigate to AI Playground in Databricks workspace
2. Select a model with "Tools enabled" label
3. Add your deployed MCP server as a tool
4. Chat with the agent - it will call your MCP tools as needed

This provides a visual way to test tool-calling behavior with different models before production integration. See [AI Playground documentation](https://docs.databricks.com/aws/en/generative-ai/agent-framework/ai-playground-agent) for details.

## Testing Strategy

1. **Integration Tests** (Automated):
   - `tests/test_integration_server.py` - Pytest-based integration tests
   - Automatically starts/stops server, tests all tools
   - Run with: `pytest tests/`

2. **Local Development** (Interactive): 
   - `scripts/dev/start_server.sh` - Start server for development

3. **Remote Deployment with OAuth** (Interactive): 
   - `scripts/dev/query_remote.sh` - Interactive script with OAuth flow
   - `scripts/dev/query_remote.py` - Tests health and user authorization tools

### Remote Testing with User Authorization

The `scripts/dev/query_remote.sh` script provides end-to-end testing of user-level OAuth authorization:

**What it does:**
1. Fetches app configuration using `databricks apps get <app_name>`
2. Extracts `effective_user_api_scopes` (the scopes granted to users)
3. Extracts app URL from configuration
4. Gets workspace host from Databricks profile
5. Generates OAuth token using `generate_oauth_token.py` with correct scopes
6. Tests MCP client with user authentication via `query_remote.py`
7. Calls both `health` tool and `get_current_user` tool to verify functionality

**Why this matters:**
- Simulates real end-user experience
- Tests user-level authentication (not service principal)
- Verifies scopes are configured correctly
- Validates both basic health check and user-authenticated operations
- Confirms `get_user_authenticated_workspace_client()` works properly

## OAuth Token Generation

The `scripts/dev/generate_oauth_token.py` script implements the [OAuth U2M (User-to-Machine) flow](https://docs.databricks.com/aws/en/dev-tools/auth/oauth-u2m?language=CLI) to generate workspace-level access tokens.

**Key features:**
- Uses `databricks-cli` OAuth client ID by default
- Implements PKCE (Proof Key for Code Exchange) for security
- Opens browser for user authorization
- Runs local HTTP server to capture OAuth callback
- Exchanges authorization code for access token
- Outputs token response as JSON
- Configurable scopes for fine-grained access control

**Output:**
- Progress messages go to stderr (visible in terminal)
- Token response (JSON) goes to stdout
- Extract access token using: `jq -r '.access_token'`

**When to use:**
- Testing OAuth flows
- Generating tokens with custom scopes
- Automation scripts requiring fresh tokens
- CI/CD pipelines needing workspace access

**Not needed for:**
- Normal development (use Databricks CLI `databricks auth login`)
- Testing the MCP server (test scripts handle authentication)

## Configuration

- **Server port**: Use `--port` argument: `uv run custom-mcp-server --port 8080`
- **Server host**: Edit `server/main.py` to change from `0.0.0.0`
- **Project name**: Update `pyproject.toml` name field
- **MCP server name**: Update `FastMCP(name="...")` in `server/app.py`

## Renaming the Project

1. Update `name` in `pyproject.toml`
2. Update `FastMCP(name="...")` in `server/app.py`
3. Update `[project.scripts]` command name in `pyproject.toml`
4. Update README references

---

**When in doubt**: Follow the patterns in `server/tools.py` for adding functionality. The tool decorator handles serialization, validation, and MCP protocol details automatically.

