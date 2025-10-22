# MCP Server - Hello World

A simple, production-ready template for building Model Context Protocol (MCP) servers using FastMCP and FastAPI. This project demonstrates how to create custom tools that AI assistants can discover and invoke.

### Key Concepts

- **Tools**: Callable functions that AI assistants can invoke (e.g., search databases, process data, call APIs)
- **Server**: Exposes tools via the MCP protocol over HTTP
- **Client**: Applications (like Claude, AI assistants) that discover and call tools

## Features

- ✅ FastMCP-based server with HTTP streaming support
- ✅ FastAPI integration for additional REST endpoints
- ✅ CORS configuration for web clients
- ✅ Example tools: health check and user information
- ✅ Production-ready project structure
- ✅ Ready for Databricks Apps deployment

## Project Structure

```
mcp-server-hello-world/
├── server/
│   ├── app.py                    # FastAPI application and MCP server setup
│   ├── main.py                   # Entry point for running the server
│   ├── tools.py                  # MCP tool definitions
│   └── utils.py                  # Databricks authentication helpers
├── scripts/
│   ├── start_server.sh           # Start the MCP server locally
│   ├── test_local.sh             # Test local MCP server (starts, tests, stops)
│   ├── test_local.py             # Test MCP client (local development)
│   ├── test_remote.sh            # Interactive script for testing deployed app with OAuth
│   ├── test_remote.py            # Test MCP client (deployed app) with health and user auth
│   └── generate_oauth_token.py   # Generate OAuth tokens for Databricks
├── pyproject.toml                # Project metadata and dependencies
├── requirements.txt              # Python dependencies (for pip)
├── app.yaml                      # Databricks Apps configuration
├── Claude.md                     # AI assistant context and documentation
└── README.md          
```

## Prerequisites

- Python 3.11 or higher
- [uv](https://github.com/astral-sh/uv) (recommended) or pip

## Installation

### Option 1: Using uv (Recommended)

```bash
# Install uv if you haven't already
# Install dependencies
uv sync
```

### Option 2: Using pip

```bash
# Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Running the Server

### Development Mode

```bash
# Quick start with script (syncs dependencies and starts server)
./scripts/start_server.sh

# Or manually using uv
uv run custom-mcp-server

# Or using the installed command (after pip install -e .)
custom-mcp-server
```

The server will start on `http://localhost:8000` with auto-reload enabled.

### Accessing the Server

- **MCP Endpoints**: `http://localhost:8000/mcp`
- **Available Tools**: 
  - `health`: Check server status
  - `get_current_user`: Get authenticated user information

## Testing the MCP Server

This project includes test scripts to verify your MCP server is working correctly in both local and deployed environments.

### Quick Start with Shell Script

Use the provided shell script to test your local MCP server:

```bash
chmod +x scripts/test_local.sh
./scripts/test_local.sh
```

This script will:
1. Sync dependencies
2. Start the MCP server in the background
3. Run the local client test
4. Stop the server automatically

### Manual Testing

#### Test Local Development

**Option 1: Automated test (recommended)**
```bash
# Starts server, runs test, stops server automatically
./scripts/test_local.sh
```

**Option 2: Manual testing**
```bash
# In terminal 1: Start the server
./scripts/start_server.sh
# Or: uv run custom-mcp-server

# In terminal 2: Test the connection
python scripts/test_local.py
```

The `scripts/test_local.py` script connects to your local MCP server without authentication and lists available tools.

#### Test Deployed App with User Authorization (OAuth)

After deploying to Databricks Apps, use the interactive shell script to test with user-level OAuth authentication:

```bash
chmod +x scripts/test_remote.sh
./scripts/test_remote.sh
```

The script will guide you through:
1. **Profile selection**: Choose your Databricks CLI profile
2. **App name**: Enter your deployed app name
3. **Automatic configuration**: Extracts app scopes and URLs automatically
4. **OAuth flow**: Generates user OAuth token via browser
5. **End-to-end test**: Tests `list_tools()`, `health` tool, and `get_current_user` tool

**What it does:**
- Retrieves app configuration using `databricks apps get`
- Extracts user authorization scopes from `effective_user_api_scopes`
- Gets workspace host from your Databricks profile
- Generates OAuth token with the correct scopes
- Tests MCP client with user-level authentication
- Verifies both the `health` check and `get_current_user` tool work correctly

This test simulates the real end-user experience when they authorize your app and use it with their credentials.

Alternatively, test manually with command-line arguments:

```bash
python scripts/test_remote.py \
    --host "https://your-workspace.cloud.databricks.com" \
    --token "eyJr...Dkag" \
    --app-url "https://your-workspace.cloud.databricks.com/serving-endpoints/your-app"
```

The `scripts/test_remote.py` script connects to your deployed MCP server with OAuth authentication and tests both the health check and user authorization functionality.

## Adding New Tools

To add a new tool to your MCP server:

1. Open `server/tools.py`
2. Add a new function inside `load_tools()` with the `@mcp_server.tool` decorator:

```python
@mcp_server.tool
def calculate_sum(a: int, b: int) -> dict:
    """
    Calculate the sum of two numbers.
    
    Args:
        a: First number
        b: Second number
    
    Returns:
        dict: Contains the sum result
    """
    return {"result": a + b}
```

3. Restart the server - the new tool will be automatically available to clients

### Tool Best Practices

- **Clear naming**: Use descriptive, action-oriented names
- **Comprehensive docstrings**: AI uses these to understand when to call your tool
- **Type hints**: Help with validation and documentation
- **Structured returns**: Return dicts or Pydantic models for consistent data
- **Error handling**: Use try-except blocks and return error information

### Connecting to Databricks

The `utils.py` module provides two helper methods for interacting with Databricks resources via the Databricks SDK Workspace Client:

**When deployed as a Databricks App:**
- `get_workspace_client()` - Returns a client authenticated as the service principal associated with the app. See [App Authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth#app-authorization) for more details.
- `get_user_authenticated_workspace_client()` - Returns a client authenticated as the end user with scopes specified by the app creator. See [User Authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth#user-authorization) for more details.

**When running locally:**
- Both methods return a client authenticated as the current developer, since no service principal identity exists in the local environment.

**Example usage in tools:**
```python
from server import utils

# Get current user information (user-authenticated)
w = utils.get_user_authenticated_workspace_client()
user = w.current_user.me()
display_name = user.display_name
```

See the `get_current_user` tool in `server/tools.py` for a complete example.

## Generating OAuth Tokens

For advanced use cases, you can manually generate OAuth tokens for Databricks workspace access using the provided script. This implements the [OAuth U2M (User-to-Machine) flow](https://docs.databricks.com/aws/en/dev-tools/auth/oauth-u2m?language=CLI).

### Generate Workspace-Level OAuth Token

```bash
python scripts/generate_oauth_token.py \
    --host https://your-workspace.cloud.databricks.com \
    --scopes "all-apis offline_access"
```

**Parameters:**
- `--host`: Databricks workspace URL (required)
- `--scopes`: Space-separated OAuth scopes (default: `all-apis offline_access`)
- `--redirect-uri`: Callback URI (default: `http://localhost:8020`)

**Note:** The script uses the `databricks-cli` OAuth client ID by default.

**The script will:**
1. Generate a PKCE code verifier and challenge
2. Open your browser for authorization
3. Capture the authorization code via local HTTP server
4. Exchange the code for an access token
5. Display the token response as JSON (token is valid for 1 hour)

**Example with custom scopes:**
```bash
python scripts/generate_oauth_token.py \
    --host https://your-workspace.cloud.databricks.com \
    --scopes "clusters:read jobs:write sql:read"
```

## Configuration

### Server Settings

Edit `server/main.py` to change server configuration:

```python
uvicorn.run(
    "server.app:combined_app",
    host="0.0.0.0",        # Bind address
    port=8000,             # Port number
    reload=True,           # Auto-reload (disable in production)
)
```

### CORS Settings

Update allowed origins in `server/app.py`:

```python
allow_origins=[
    'http://localhost:3000',    # Add your frontend origins
    'https://your-domain.com',
]
```

## Deployment

### Databricks Apps

This project is configured for Databricks Apps deployment:

1. Deploy using Databricks CLI or UI
2. The server will be accessible at your Databricks app URL

For more information refer to the documentation [here](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy#deploy-the-app)

### Try Your MCP Server in AI Playground

After deploying your MCP server to Databricks Apps, you can test it interactively in the Databricks AI Playground:

1. Navigate to the **AI Playground** in your Databricks workspace
2. Select a model with the **Tools enabled** label
3. Click **Tools > + Add tool** and select your deployed MCP server
4. Start chatting with the AI agent - it will automatically call your MCP server's tools as needed

The AI Playground provides a visual interface to prototype and test your MCP server with different models and configurations before integrating it into production applications.

For more information, see [Prototype tool-calling agents in AI Playground](https://docs.databricks.com/aws/en/generative-ai/agent-framework/ai-playground-agent).

## Development

### Code Formatting

```bash
# Format code with ruff
uv run ruff format .

# Check for lint errors
uv run ruff check .
```

## Customization

### Rename the Project

1. Update `name` in `pyproject.toml`
2. Update `name` parameter in `server/app.py`: `FastMCP(name="your-name")`
3. Update the command script in `pyproject.toml` under `[project.scripts]`

### Add Custom API Endpoints

Add routes to the `app` FastAPI instance in `server/app.py`:

```python
@app.get("/custom-endpoint")
def custom_endpoint():
    return {"message": "Hello from custom endpoint"}
```

## Troubleshooting

### Port Already in Use

Change the port in `server/main.py` or set the `PORT` environment variable.

### CORS Errors

Add your client's origin to the `allow_origins` list in `server/app.py`.

### Import Errors

Ensure all dependencies are installed:
```bash
uv sync  # or pip install -r requirements.txt
```

## Resources
- [Databricks MCP Documentation](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp)
- [Databricks Apps](https://www.databricks.com/product/databricks-apps)
- [FastMCP Documentation](https://github.com/jlowin/fastmcp)
- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [Uvicorn Documentation](https://www.uvicorn.org)

## AI Assistant Context

See [`Claude.md`](./Claude.md) for detailed project context specifically designed for AI assistants working with this codebase.


