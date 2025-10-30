# Deploy an MCP server for any REST API with Databricks Apps

This app template contains an MCP server that exposes tools for invoking external REST APIs, enabling agents to fetch data or take actions in remote services. To use this template, you need:

1. A JSON [OpenAPI specification](https://learn.openapis.org/specification/) file for the external REST API
2. A [Databricks Unity Catalog connection](https://docs.databricks.com/aws/en/generative-ai/agent-framework/external-connection-tools) for securely managing authentication to the external REST API

If your external service already provides an MCP server, Databricks recommends [creating a connection to the external MCP server](https://docs.databricks.com/aws/en/generative-ai/mcp/external-mcp) instead; Databricks provides a proxy to the external MCP server automatically, saving you the step of deploying a Databricks app.

You can deploy this app as-is, with some changes to app.yaml - see [Quickstart](#Quickstart) for details

## Overview

This MCP server acts as a bridge between LLM agents and external REST APIs. It:

1. **Loads OpenAPI specifications** from the specified UC Volume Path
2. **Provides three main tools** to LLM agents:
   - `list_api_endpoints` - Discover available API endpoints
   - `get_api_endpoint_schema` - Get detailed schema for specific endpoints
   - `invoke_api_endpoint` - Execute API calls with proper authentication
3. **Uses Databricks UC external connections** for secure authentication to external services
4. **Runs on Databricks Apps** for scalable hosting

## Quickstart

### 1. Configure Your External API

[Upload](https://docs.databricks.com/aws/en/ingestion/file-upload/upload-to-volume) your OpenAPI Spec (`spec.json`) to your desired Volume. [Configure](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/resources) this volume path as a dependent resource in your Databricks App. 

**Note**: If the file name of your open api spec is different from `spec.json`, update it in the `app.yaml`
```yaml
# Line 6 in app.yaml
  - name: "SPEC_FILE_NAME"
    value: "spec.json" # Update file name if needed
```

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
# Line 4 in app.yaml
  - name: "UC_CONNECTION_NAME"
    value: "" # TODO: Add the connection name
```

### 4. Deploy to Databricks Apps
Now you can [deploy](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy) this to Databricks Apps.

```bash
databricks sync --watch . /Workspace/Users/my-email@org.com/<app-name>

databricks apps deploy <app-name> --source-code-path /Workspace/Users/my-email@org.com/<app-name>
```

### 5. Try it out in AI Playground
After deploying your MCP server to Databricks Apps, you can test it interactively in the Databricks AI Playground:

1. Navigate to the **AI Playground** in your Databricks workspace
2. Select a model with the **Tools enabled** label
3. Click **Tools > + Add tool** and select your deployed MCP server
4. Start chatting with the AI agent - it will automatically call your MCP server's tools as needed

The AI Playground provides a visual interface to prototype and test your MCP server with different models and configurations before integrating it into production applications.

For more information, see [Prototype tool-calling agents in AI Playground](https://docs.databricks.com/aws/en/generative-ai/agent-framework/ai-playground-agent).

## Running the MCP Server Locally

### Prerequisites

- Databricks CLI installed and configured
- `uv` (Python package manager)
- Unity Catalog external connection configured for your target API

### Get Started
- Run `uv` sync:

```bash
uv sync
```

- Start the server locally. Changes will trigger a reload:

```bash
uv run custom-server
```

## Testing

The repository includes an integration test to verify your MCP server functionality.

### Local Testing

Test your MCP server with the integration test:

```bash
DATABRICKS_CONFIG_PROFILE=<your-profile> \
UC_CONNECTION_NAME=<your-connection> \
SPEC_VOLUME_PATH=<your-volume-path> \
SPEC_FILE_NAME=<your-spec-file> \
uv run pytest tests/test_integration_server.py
```

This integration test will:
- Start the MCP server automatically
- Test all MCP tools (list_api_endpoints, get_api_endpoint_schema, invoke_api_endpoint)
- Verify server health
- Clean up after completion

### Remote Testing

For testing deployed MCP servers on Databricks Apps, use the remote query script:

```bash
./scripts/dev/query_remote.sh
```

This script will:
1. Prompt for your Databricks profile
2. Prompt for the deployed app URL
3. Generate an OAuth token for authentication
4. Test the remote MCP server
5. Display available tools and sample API endpoints

### Manual Server Start

If you prefer to start the server manually without testing:

```bash
./scripts/dev/start_server.sh
```

Make sure you have set the required environment variables first:
- `DATABRICKS_CONFIG_PROFILE` - Your Databricks profile name
- `UC_CONNECTION_NAME` - Your Unity Catalog connection name
- `SPEC_VOLUME_PATH` - Path to your OpenAPI spec (e.g., `/Volumes/catalog/schema/volume`)
- `SPEC_FILE_NAME` - Name of the spec file (e.g., `spec.json`)

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

## Using the MCP Server

### Connecting to the MCP Server

Once deployed, your MCP server will be available at:

```
https://your-app-url.usually.ends.with.databricksapps.com/mcp
```

**Important**: The URL must end with `/mcp` (without the trailing slash).

### Authentication

Generate an OAuth token for authentication:

```bash
python scripts/dev/generate_oauth_token.py \
    --host <your-workspace-host> \
    --scopes <required-scopes>
```

This will open your browser for authorization and return an access token that you can use to authenticate with the MCP server.

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
