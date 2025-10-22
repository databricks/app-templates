# CLAUDE.MD

This document provides architectural context and implementation details for the Custom OpenAPI Spec MCP Server project. It's designed to help AI assistants understand the codebase structure, patterns, and conventions.

## Project Overview

This is a [**Model Context Protocol (MCP) server**](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp) that bridges LLM agents with external REST APIs defined by OpenAPI specifications. It runs as a [**Databricks App**](https://www.databricks.com/product/databricks-apps) and uses [**Unity Catalog external connections**]((https://docs.databricks.com/aws/en/generative-ai/agent-framework/external-connection-tools)) for secure API authentication.

### Core Purpose

- Parse OpenAPI 3.x specifications from Databricks Volumes
- Expose three layered MCP tools for API discovery, schema inspection, and execution
- Handle authentication transparently through Databricks UC external connections
- Provide token-efficient, well-structured responses for LLM agents

### Key Technologies

- **FastAPI**: Web framework for HTTP endpoints and middleware
- **FastMCP**: MCP protocol implementation (`mcp[cli]` package)
- **Databricks SDK**: Integration with Unity Catalog and external connections
- **Pydantic**: Schema validation and serialization
- **uvicorn**: ASGI server for local development and production

## Architecture

### Layered Tool Design

The server implements a **progressive disclosure pattern** for API interactions:

1. **Discovery Layer** (`list_api_endpoints`)
   - Returns filtered list of available endpoints
   - Limited to 50 endpoints to avoid token bloat
   - Searchable by path, method, description, tags

2. **Planning Layer** (`get_api_endpoint_schema`)
   - Provides detailed OpenAPI operation schema
   - Shows parameters, request/response formats, examples
   - Enables agents to understand how to structure requests

3. **Execution Layer** (`invoke_api_endpoint`)
   - Executes actual API calls with UC external connection auth
   - Handles parameter formatting (query params vs JSON body)
   - Returns normalized responses with status, headers, and body

### Data Flow

```
LLM Agent Request → FastAPI Middleware → MCP Tool Handler → 
→ OpenAPI Spec Lookup → UC External Connection → External API
```

1. **Request arrives** at FastAPI app with Databricks token in headers
2. **Middleware captures** authentication headers into context variable
3. **MCP tool invoked** with validated Pydantic schemas
4. **Handler logic** processes request using OpenAPI spec and Databricks SDK
5. **UC external connection** provides secure auth to external API
6. **Response normalized** and returned as structured data

## File Structure

```
src/custom_server/
├── __init__.py           # Package initialization
├── main.py               # Entry point for uvicorn
├── app.py                # FastAPI app configuration and routes
├── tools.py              # MCP tool definitions and registration
├── handlers.py           # Business logic for each tool
├── schemas.py            # Pydantic request/response models
├── utils.py              # OpenAPI spec loading + auth utilities
└── static/
    └── index.html        # Landing page for web browser access

scripts/
├── start_server.sh       # Start the MCP server locally
├── test_local.sh         # Automated local testing script
├── test_local.py         # Python test client for local server
├── test_remote.sh        # Automated remote testing script
├── test_remote.py        # Python test client for remote server
├── generate_oauth_token.py  # OAuth token generation utility
└── README.md             # Scripts documentation

hooks/
└── apps_build.py         # Custom build hook for Databricks Apps
```

### Key Components

#### `main.py`
- **Entry point** for `uv run custom-open-api-spec-server` command
- Configures uvicorn with hot reload for development
- Runs on `0.0.0.0:8000` for container compatibility

#### `app.py`
- **Main FastAPI application** with `/health` and `/` endpoints
- **Middleware** for capturing authentication headers
- **Mounts MCP app** at `/mcp` path for protocol handling
- **Combined app** serves both custom routes and MCP protocol endpoints

Key patterns:
- Uses `FastMCP` for MCP server creation
- Middleware captures headers in context variable for downstream use
- Custom routes for health checks and web interface
- MCP app mounted as sub-application

#### `tools.py`
- **MCP tool registration** using `@mcp.tool()` decorator
- **`load_tools(mcp_server)` function** registers all tools with the MCP server
- **Tool wrappers** that convert between MCP format and internal schemas

Key patterns:
- Converts tool responses to dictionaries with `.model_dump()`
- Handles JSON serialization errors gracefully in `invoke_api_endpoint`
- Each tool function directly decorated with `@mcp_server.tool()`

#### `handlers.py`
- **Pure business logic** for each MCP tool
- **No FastAPI dependencies** - takes Pydantic schemas, returns Pydantic schemas
- **Uses `get_user_workspace_client()`** for Databricks SDK operations
- **Handles parameter formatting** based on HTTP method

Important details:
- `list_api_endpoints`: Filters and limits to 50 results
- `get_api_endpoint_schema`: Returns raw OpenAPI operation object
- `invoke_api_endpoint`: Maps HTTP methods to Databricks SDK enums, handles query params vs body

#### `schemas.py`
- **All Pydantic models** for request/response validation
- **Clear field descriptions** for auto-generated MCP tool schemas
- **Flexible types** (e.g., `Union[Dict, str]` for parameters)

Key schemas:
- `EndpointMetadata`: Represents a single API endpoint summary
- `InvokeApiEndpointRequest`: Flexible parameters field (dict or string)
- `InvokeApiEndpointResponse`: Normalized HTTP response structure

#### `utils.py`
- **OpenAPI spec caching** in global variable
- **Authentication extraction** from request headers
- **WorkspaceClient creation** with forwarded token or profile

Important patterns:
- Uses `contextvars.ContextVar` for thread-safe header storage
- Loads spec from Databricks Volume using `w.files.download()`
- `get_workspace_client()`: Creates client with profile for local use
- `get_user_authenticated_workspace_client()`: Creates client with forwarded token for app use
- Expects `x-forwarded-access-token` header (Databricks convention)

## Configuration

### Environment Variables (app.yaml)

- `UC_CONNECTION_NAME`: Unity Catalog external connection name (required)
- `SPEC_VOLUME_PATH`: Path to Volume containing `spec.json` (required)

### OpenAPI Spec Format

Expected file: `{SPEC_VOLUME_PATH}/spec.json`

Requirements:
- Valid OpenAPI 3.x specification
- Must include `paths` object with operations
- Each operation should have `summary`, `description`, `operationId` for best results
- `servers[0].url` defines base URL for API (optional, UC connection defines host)

### UC External Connection

The connection must be configured in Unity Catalog:
- Type: `http`
- Authentication: Bearer, M2M, U2M Shared or U2M
- Host matches the external API base URL

```sql
-- Example: Create connection with API key authentication
CREATE CONNECTION <connection-name> TYPE HTTP
OPTIONS (
  host '<hostname>',
  port '<port>',
  base_path '<base-path>',
  bearer_token '<bearer-token>'
);
```
[Learn more about external connections](https://docs.databricks.com/aws/en/query-federation/http).

## Authentication Flow

1. **Client sends request** to MCP server with Bearer token from Databricks profile
2. **FastAPI middleware** captures `x-forwarded-access-token` header
3. **Handler creates WorkspaceClient** using captured token
4. **WorkspaceClient calls** `serving_endpoints.http_request()` with UC connection
5. **UC connection handles** authentication to external API (transparent to server)
6. **External API response** flows back through Databricks SDK

The server **never sees external API credentials** - all auth handled by UC.

## Dependencies Explained

### Core Dependencies
- `fastapi>=0.115.12`: Web framework for HTTP endpoints
- `mcp[cli]>=1.14.0`: MCP protocol implementation (includes `fastmcp`)
- `uvicorn>=0.34.2`: ASGI server for running FastAPI
- `databricks-sdk>=0.60.0`: SDK for UC connections and workspace operations
- `pydantic>=2`: Schema validation and serialization

### Dev Dependencies
- `hatchling>=1.27.0`: Build backend for Python packages
- `ruff>=0.8.0`: Fast Python linter and formatter

### Package Management
- Uses `uv` for fast, reproducible dependency management
- `pyproject.toml` defines project metadata and dependencies
- `uv.lock` ensures consistent installs across environments

## Important Patterns & Conventions

### Pydantic Schema Validation
All MCP tool arguments and responses flow through Pydantic models:
```python
# In server.py - convert to dict for MCP
return result.model_dump()

# In handlers.py - receive validated schema
def list_api_endpoints(args: ListApiEndpointsRequest) -> ListApiEndpointsResponse:
    ...
```

### Context Variable for Headers
Authentication headers stored in `contextvars.ContextVar` for thread-safety:
```python
# Middleware sets
header_store.set(dict(request.headers))

# Utils reads
headers = header_store.get({})
token = headers.get("x-forwarded-access-token")
```

### HTTP Method Mapping
Databricks SDK uses enums, not strings:
```python
method_mapping = {
    "GET": ExternalFunctionRequestHttpMethod.GET,
    "POST": ExternalFunctionRequestHttpMethod.POST,
    # ...
}
```

### Parameter Handling by Method
- **GET/DELETE**: Parameters converted to query string
- **POST/PUT/PATCH**: Parameters sent as JSON body
- Supports both `Dict[str, Any]` and string (with JSON parsing)

### Error Handling
- All handlers raise exceptions on error
- `tools.py` catches exceptions in tool wrappers and returns structured error responses
- Includes helpful error messages for debugging

## Common Tasks

### Adding a New MCP Tool
1. Define Pydantic schemas in `schemas.py`
2. Implement handler logic in `handlers.py`
3. Register tool in `tools.py` within the `load_tools()` function using `@mcp_server.tool()` decorator
4. Add docstring for auto-generated tool description

### Modifying OpenAPI Spec Loading
- Edit `utils.py` `load_openapi_spec()` function
- Currently loads from `{SPEC_VOLUME_PATH}/spec.json`
- Global cache prevents repeated file reads

### Changing Authentication Method
- Modify `get_user_authenticated_workspace_client()` in `utils.py`
- Update middleware in `app.py` if header name changes
- Ensure UC external connection type matches

### Updating API Response Format
- Modify `InvokeApiEndpointResponse` schema in `schemas.py`
- Update response construction in `handlers.py` `invoke_api_endpoint()`
- Adjust serialization logic in `tools.py` `invoke_api_endpoint()` wrapper if needed

## Deployment

### Local Development
```bash
uv sync                    # Install dependencies
uv run custom-server       # Start with hot reload
```

Access at: `http://localhost:8000`

### Databricks Apps Deployment
1. Update `UC_CONNECTION_NAME` and `SPEC_VOLUME_PATH` in `app.yaml`
2. Deploy using Databricks CLI or UI
3. App runs command: `uv run custom-server`
4. Access at: `https://your-app-url.databricksapps.com/mcp`

### Build Hook
`hooks/apps_build.py` provides custom build logic for Databricks Apps (exact behavior depends on implementation).

## Testing & Debugging

### Automated Testing Scripts

The project includes comprehensive test scripts to verify MCP server functionality:

#### Local Testing (`scripts/test_local.sh`)
Tests the MCP server running on your local machine:
```bash
./scripts/test_local.sh
```

Features:
- Prompts for Databricks profile, UC connection name, and spec volume path
- Sets up environment variables automatically
- Starts the server in the background
- Connects using `DatabricksMCPClient` at `http://0.0.0.0:8000/mcp`
- Lists available MCP tools
- Calls `list_api_endpoints` to verify API discovery
- Automatically cleans up and stops the server

Python test implementation: `scripts/test_local.py`

#### Remote Testing (`scripts/test_remote.sh`)
Tests a deployed MCP server on Databricks Apps:
```bash
./scripts/test_remote.sh
```

Features:
- Prompts for Databricks profile and deployed app URL
- Generates OAuth token using `scripts/generate_oauth_token.py`
- Connects to the remote MCP server
- Verifies all MCP tools are accessible
- Tests API endpoint discovery on the deployed instance

Python test implementation: `scripts/test_remote.py`

#### Manual Server Start (`scripts/start_server.sh`)
Starts the server without running tests:
```bash
./scripts/start_server.sh
```

Requires pre-set environment variables:
- `DATABRICKS_CONFIG_PROFILE`
- `UC_CONNECTION_NAME`
- `SPEC_VOLUME_PATH`

### Manual Testing
- Use MCP inspector or direct HTTP requests
- Set logging level to `DEBUG` in `app.py` for verbose output
- Check `/health` endpoint for basic connectivity
- Access root endpoint `/` for the web interface

### Debugging Tips
1. **Auth issues**: Check `x-forwarded-access-token` header presence. If this header is not present, its ideally because the user has queried the app without an Exact Scope OAuth Token.
2. **Spec loading errors**: Verify `SPEC_VOLUME_PATH` environment variable
3. **UC connection errors**: Validate connection name and permissions
4. **JSON serialization**: Check response handling in `tools.py` invoke_api_endpoint function
5. **Local testing fails**: Ensure `DATABRICKS_CONFIG_PROFILE` is set and valid
6. **Remote testing fails**: Verify app URL and OAuth token generation

### Logging
- Uses Python `logging` module
- Current level: `INFO`
- Add `logger.debug()` calls for detailed tracing
- Check server logs for OpenAPI spec loading and UC connection errors

## Code Quality

### Ruff Configuration
- Line length: 100 characters
- Target: Python 3.11+
- Enforces: import sorting, bugbear rules, type checking

### Type Hints
- Pydantic models provide runtime validation
- Type hints used throughout for clarity
- `Optional` for nullable fields, `Union` for multiple types

## Security Considerations

1. **Never log tokens** or sensitive headers
2. **UC connection credentials** never exposed to server code
3. **Token validation** handled by Databricks infrastructure
4. **Input validation** via Pydantic prevents injection attacks
5. **OpenAPI spec** should be sanitized if user-provided

## Performance Optimization

- **Global OpenAPI spec cache** prevents repeated file I/O
- **Endpoint limiting** (50 max) prevents token overflow
- **Context variables** avoid thread contention
- **Structured responses** enable efficient parsing by LLMs

## Extension Points

### Supporting Additional HTTP Methods
Add to `handlers.py` method_mapping and OpenAPI method filter.

### Custom Response Formatting
Modify `InvokeApiEndpointResponse` and response construction logic.

### Multiple OpenAPI Specs
Extend `utils.py` to load multiple specs and add spec selection parameter to tools.

### Caching API Responses
Add caching layer in `handlers.py` `invoke_api_endpoint()`.

### Rate Limiting
Implement middleware in `app.py` to track and limit requests.

## Related Documentation

- [Databricks MCP Documentation](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp)
- [Databricks Apps](https://www.databricks.com/product/databricks-apps)
- [OpenAPI Specification](https://github.com/OAI/OpenAPI-Specification)
- [FastMCP Documentation](https://github.com/jlowin/fastmcp)
- [Pydantic V2 Docs](https://docs.pydantic.dev/latest/)

## Quick Reference

### File Locations
- FastAPI app: `src/custom_server/app.py`
- MCP tools: `src/custom_server/tools.py`
- Business logic: `src/custom_server/handlers.py`
- Data models: `src/custom_server/schemas.py`
- Utilities: `src/custom_server/utils.py`
- Entry point: `src/custom_server/main.py`
- Config: `app.yaml`, `pyproject.toml`
- Test scripts: `scripts/`

### Key Classes
- `FastMCP`: MCP server instance
- `WorkspaceClient`: Databricks SDK client
- `ListApiEndpointsResponse`: Endpoint discovery result
- `InvokeApiEndpointResponse`: API execution result

### Environment Setup
- Python: 3.11+
- Package manager: `uv`
- Web framework: FastAPI + Uvicorn
- MCP protocol: FastMCP

---

**Last Updated**: October 2025  
**Version**: Based on project structure and implementation as of main branch

