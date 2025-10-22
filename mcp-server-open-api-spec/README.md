# Custom Open API Spec MCP Server on Databricks Apps

This repository provides a framework for creating [Custom Model Context Protocol (MCP) servers](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp) using [Databricks Apps](https://www.databricks.com/product/databricks-apps). It enables customers to create MCP servers that connect to external REST APIs defined by [OpenAPI specifications](https://github.com/OAI/OpenAPI-Specification), with secure authentication through [Databricks external connections](https://docs.databricks.com/aws/en/generative-ai/agent-framework/external-connection-tools).

## Overview

This MCP server acts as a bridge between LLM agents and external REST APIs. It:

1. **Loads OpenAPI specifications** from the specified UC Volume Path
2. **Provides three main tools** to LLM agents:
   - `list_api_endpoints` - Discover available API endpoints
   - `get_api_endpoint_schema` - Get detailed schema for specific endpoints
   - `invoke_api_endpoint` - Execute API calls with proper authentication
3. **Uses Databricks UC external connections** for secure authentication to external services
4. **Runs on Databricks Apps** for scalable hosting

## Quick Start

### 1. Configure Your External API

Upload your OpenAPI Spec (`spec.json`) to your desired Volume. Configure this volume path as a dependent resource in your Databricks App

### 2. Create UC External Connection

Create a Unity Catalog external connection for authentication to your external service:

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

[Learn more about external connections](https://docs.databricks.com/aws/en/query-federation/http). You can configure authentication to be either Bearer, OAuth M2M, OAuth U2M Shared and OAuth U2M.

### 3. Update Connection Name

Update the connection name environment variable in `app.yaml`.

```yaml
# Line 5 in app.yaml
  - name: "UC_CONNECTION_NAME"
    value: "" # TODO: Add the connection name
```

## Prerequisites

- Databricks CLI installed and configured
- `uv` (Python package manager)
- Unity Catalog external connection configured for your target API

## Local development

- run `uv` sync:

```bash
uv sync
```

- start the server locally. Changes will trigger a reload:

```bash
uv run custom-server
```

## Using the MCP Server

### Connecting to the MCP Server

Once deployed, your MCP server will be available at:

```
https://your-app-url.usually.ends.with.databricksapps.com/mcp
```

**Important**: The URL must end with `/mcp` (without the trailing slash).

### Authentication

Use a Bearer token from your Databricks profile:

```bash
databricks auth token -p <name-of-your-profile>
```

### Available MCP Tools

Your deployed server provides three tools to LLM agents:

1. **`list_api_endpoints`**
   - Discovers available API endpoints from your OpenAPI spec
   - Optional search filtering by path, method, or description

2. **`get_api_endpoint_schema`**
   - Gets detailed schema information for a specific endpoint
   - Includes request/response schemas, parameters, etc.

3. **`invoke_api_endpoint`**
   - Executes API calls to your external service
   - Handles authentication via UC external connections
   - Supports all HTTP methods (GET, POST, PUT, DELETE, PATCH)

### Tool Design Best Practices

#### **Layered Architecture**
The three tools follow a progressive "discovery → planning → execution" pattern:

1. **Discovery Layer** (`list_api_endpoints`)
   - Helps agents understand what APIs are available
   - Provides search/filtering to avoid overwhelming responses
   - Returns human-readable summaries and descriptions

2. **Planning Layer** (`get_api_endpoint_schema`)
   - Gives detailed schema information for proper request formation
   - Shows required parameters, data types, and expected responses
   - Enables agents to understand how to structure API calls correctly

3. **Execution Layer** (`invoke_api_endpoint`)
   - Performs the actual API requests with proper authentication
   - Handles different HTTP methods and parameter formats
   - Returns structured, meaningful responses

#### **Key Design Principles**

- **Token Efficiency**: Built-in pagination (50 endpoint limit) and search filtering
- **Clear Naming**: Tool names clearly indicate their purpose and scope
- **Meaningful Context**: Returns natural language descriptions alongside technical data
- **Error Handling**: Provides helpful error messages that guide agents toward successful requests
- **Flexible Responses**: Supports various parameter formats (JSON objects, strings, query params)
- **Authentication Abstraction**: Handles complex UC external connection authentication transparently

This layered approach prevents agents from being overwhelmed while providing the structured guidance needed for reliable API interactions.

## Configuration Details

### OpenAPI Specification Format

Your `spec.json` should be a valid OpenAPI 3.x specification. Example structure:

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Your API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://your-api.example.com"
    }
  ],
  "paths": {
    "/your/endpoint": {
      "get": {
        "summary": "Your endpoint description",
        "parameters": [...],
        "responses": {...}
      }
    }
  }
}
```

## Troubleshooting

### Common Issues

1. **"Authentication token not found"**
   - Ensure your UC external connection is properly configured
   - Verify the connection name in `app.yaml` matches your UC connection

2. **"OpenAPI spec file not found"**
   - Check that Volume path exists and is valid JSON
   - Validate your OpenAPI spec using tools like [Swagger Editor](https://editor.swagger.io/)

3. **"Endpoint not found in API specification"**
   - Verify the endpoint path matches exactly what's in your OpenAPI spec
   - Check that the HTTP method is supported in your spec

### Debugging

Enable detailed logging by setting the log level in `app.py`:

```python
logging.basicConfig(level=logging.DEBUG)
```

## Resources

- [Databricks MCP Documentation](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp)
- [Databricks Apps](https://www.databricks.com/product/databricks-apps)
- [OpenAPI Specification](https://github.com/OAI/OpenAPI-Specification)
- [External Connections](https://docs.databricks.com/aws/en/query-federation/http)
- [Agent Framework External Tools](https://docs.databricks.com/aws/en/generative-ai/agent-framework/external-connection-tools)
