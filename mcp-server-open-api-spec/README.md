# Deploy an MCP server for any REST API with Databricks Apps

This app template contains an MCP server that exposes tools for invoking external REST APIs, enabling agents to fetch data or take actions in remote services. 

If your external service already provides an MCP server, we recommend [creating a connection to the external MCP server](https://docs.databricks.com/aws/en/generative-ai/mcp/external-mcp) instead; Databricks provides a proxy to the external MCP server automatically, saving you the step of deploying a Databricks app.

See [Quickstart](#Quickstart) for details on how to deploy an MCP server with this template.

## Overview

This MCP server acts as a bridge between LLM agents and external REST APIs. It:

1. **Loads OpenAPI specifications** from a JSON spec file
2. **Provides three main tools** to LLM agents:
   - `list_api_endpoints` - Discover available API endpoints
   - `get_api_endpoint_schema` - Get detailed schema for specific endpoints
   - `invoke_api_endpoint` - Execute API calls with proper authentication
3. **Uses Databricks [Unity Catalog connections](https://docs.databricks.com/aws/en/query-federation/http)** for secure authentication to external services
4. **Runs on [Databricks Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)** for secure and scalable hosting

## Quickstart

### Prerequisites
To use this template, you need:

1. A JSON [OpenAPI specification](https://learn.openapis.org/specification/) file for the external REST API
2. Credentials for your REST API; the full set of supported authentication types (OAuth Machine to Machine, OAuth User to Machine, Bearer token, etc is described [here](https://docs.databricks.com/aws/en/query-federation/http#authentication-methods-for-external-services)
3. An installation of the [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install)

### Fetch app code

#### Copy deployed app code
If you deployed this app via the template UI on Databricks, visit the app detail page in the UI and follow instructions to
copy the app code locally via `databricks workspace export-dir`.

#### Clone from git
If starting from this README, check out the repository and enter the app template:

```
git clone https://github.com/databricks/app-templates
cd mcp-server-open-api-spec
```

### Upload your OpenAPI spec

[Upload](https://docs.databricks.com/aws/en/ingestion/file-upload/upload-to-volume) your OpenAPI Spec (`spec.json`) to a Unity Catalog (UC) Volume on Databricks, so that the app can download it once deployed.

### Configure the app to load your OpenAPI spec
By default, the app will attempt to load your OpenAPI spec from a `spec.json` file at the root of the Volume. If you uploaded the OpenAPI spec to a different path, update the app configuration in `app.yaml` to reference your OpenAPI spec:

```yaml
  - name: "SPEC_FILE_NAME"
    # Specify the path of your JSON OpenAPI spec file relative to its parent UC volume.
    # For example, for a spec file at /Volumes/<catalog_identifier>/<schema_identifier>/<volume_identifier>/relative/path/to/spec.json,
    # use the following value:
    value: "relative/path/to/spec.json"
```

### Find or create a UC connection for authentication

Find or create a [Unity Catalog HTTP connection](https://docs.databricks.com/aws/en/query-federation/http) for authentication to your external service.
Supported authentication types include Bearer, OAuth Machine to Machine, and Oauth User to Machine (per user) authentication.

NOTE: this requires the `CREATE CONNECTION` privilege. If you do not have this privilege, reach out to a Databricks admin for help creating the connection.


### Configure the app to use your UC connection for authentication
Update the connection name environment variable in `app.yaml`.

```yaml
# Line 4 in app.yaml
  - name: "UC_CONNECTION_NAME"
    value: "" # TODO: Specify your connection name here
```

### Create the app
**NOTE: You can skip this step if you deployed the MCP server via the app template UI on Databricks**, in which case
an app already exists. Otherwise, create an app via the following, updating `UC_VOLUME_NAME` to the name of the
UC volume containing your OpenAPI spec, and `APP_NAME` to a custom app name if desired:

```bash
APP_NAME="mcp-server-rest-api"
UC_VOLUME_NAME="smurching.default.agent_codegen_sep_23_10_payload_request_logs_checkpoints"
databricks apps create --json '{
  "name": "'"$APP_NAME"'",
  "resources": [
     {
         "name": "spec_volume_path",
         "uc_securable": {
             "securable_full_name": "'"$UC_VOLUME_NAME"'",
             "securable_type": "VOLUME",
             "permission": "READ_VOLUME"
         }
     }
  ]
}'
```

### Deploy to Databricks Apps
Double-check that all TODOs in `app.yaml` have been addressed. 
Then, [deploy](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy) your server to Databricks Apps via the following (update
`APP_NAME` if needed to the name of your app):

```bash
APP_NAME="mcp-server-rest-api"
DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
databricks sync . "/Users/$DATABRICKS_USERNAME/mcp-server-rest-api"
databricks apps deploy "$APP_NAME" --source-code-path "/Workspace/Users/$DATABRICKS_USERNAME/mcp-server-rest-api"
```

### Connect to the MCP server

#### Use AI Playground
After deploying your MCP server to Databricks Apps, you can test it interactively in the [Databricks AI Playground](https://docs.databricks.com/aws/en/generative-ai/agent-framework/ai-playground-agent).
The AI Playground provides a visual interface to prototype and test your MCP server with different models and configurations before integrating it into production applications:

1. Navigate to the **AI Playground** in your Databricks workspace
2. Select a model with the **Tools enabled** label
3. Click **Tools > + Add tool** and select your deployed MCP server
4. Start chatting with the AI agent - it will automatically call your MCP server's tools as needed

#### Build an agent on Databricks
To build and deploy agents on Databricks that connect to your MCP server to discover and execute tools, [see here](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp#example-notebooks-build-an-agent-with-databricks-mcp-servers).

#### Connect from external MCP clients
You can also connect to the MCP server using standard clients like the MCP inspector, following [this documentation](https://docs.databricks.com/aws/en/generative-ai/mcp/connect-external-services)

## Running the MCP Server Locally
You can also run the MCP server in this app template locally, for ease of debugging.

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
