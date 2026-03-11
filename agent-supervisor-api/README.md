# Agent using Supervisor API

This template defines a conversational agent app that uses the [Databricks Supervisor API](https://docs.databricks.com/aws/en/generative-ai/agent-bricks/supervisor-api.html) for server-side tool execution. The app comes with a built-in chat UI, but also exposes an API endpoint for invoking the agent so that you can serve your UI elsewhere.

Instead of managing an agent loop in application code, this template passes the model, tools, and input to a single Databricks endpoint. Databricks handles tool selection and response synthesis, so your agent code stays minimal.

The Supervisor API is multi-AI: swap the model name (e.g. from `databricks-claude-sonnet-4-5` to `databricks-gpt-5-2`) to change AI providers without modifying tool or agent logic.

## Requirements

- AI Gateway (Beta) enabled for your account. See [Manage previews](https://docs.databricks.com/aws/en/admin/workspace-settings/manage-previews.html).
- `uv` (Python package manager), `nvm` (Node version manager), and the Databricks CLI installed locally.

> **Note**: The Supervisor API is routed through AI Gateway at `/mlflow/v1/responses`, not through the standard model serving endpoint at `/serving-endpoints`. The template configures `DatabricksOpenAI` with `base_url=f"{host}/mlflow/v1"` to point to the correct endpoint.

## Build with AI Assistance

We recommend using AI coding assistants (Claude Code, Cursor, GitHub Copilot) to customize and deploy this template. Agent Skills in `.claude/skills/` provide step-by-step guidance for common tasks like setup, adding tools, and deployment. These skills are automatically detected by Claude, Cursor, and GitHub Copilot.

## Quick start

Run the `uv run quickstart` script to quickly set up your local environment and start the agent server. At any step, if there are issues, refer to the manual local development loop setup below.

This script will:

1. Verify uv, nvm, and Databricks CLI installations
2. Configure Databricks authentication
3. Configure agent tracing, by creating and linking an MLflow experiment to your app
4. Start the agent server and chat app

```bash
uv run quickstart
```

After the setup is complete, you can start the agent server and the chat app locally with:

```bash
uv run start-app
```

This will start the agent server and the chat app at http://localhost:8000.

**Next steps**: see [modifying your agent](#modifying-your-agent) to customize and iterate on the agent code.

## Modifying your agent

The key files for customizing this template:

| File | Purpose |
|---|---|
| `agent_server/agent.py` | Agent logic: model, tools, handlers |
| `databricks.yml` | Bundle config and resource permissions |

### Changing the model

Edit the `MODEL` variable in `agent_server/agent.py`:

```python
MODEL = "databricks-gpt-5-2"  # switch to any Databricks-hosted model
```

No other code changes are needed — the Supervisor API handles the rest.

### Adding hosted tools

Edit the `TOOLS` list in `agent_server/agent.py`. Supported tool types: `uc_function`, `genie`, `agent_endpoint`, `mcp`. For each tool you add, grant the corresponding permission in `databricks.yml`. See the `add-tools` skill for examples.

## How the client is configured

`DatabricksOpenAI` defaults to `{host}/serving-endpoints` as its base URL. The Supervisor API is served by AI Gateway at a **dedicated subdomain**, not the workspace host:

```
https://<workspace_id>.ai-gateway.<domain>/mlflow/v1/responses
```

The `_ai_gateway_base_url()` helper in `agent_server/agent.py` derives this URL automatically from the workspace host and ID:

```python
def _ai_gateway_base_url(wc: WorkspaceClient) -> str:
    host = wc.config.host          # e.g. https://my-workspace.cloud.databricks.com
    workspace_id = wc.get_workspace_id()
    domain = re.match(r"https://[^.]+\.(.+)", host).group(1)
    return f"https://{workspace_id}.ai-gateway.{domain}/mlflow/v1"
```

Authentication is handled automatically by the `WorkspaceClient` using your configured Databricks CLI credentials.

## Deploying to Databricks Apps

```bash
databricks bundle deploy && databricks bundle run agent_supervisor_api
```

After the first deployment, the app URL is printed. Subsequent deployments update the existing app in place.

## Running tests

```bash
uv run pytest tests/ -v
```

Unit tests run without credentials. Integration tests against the live Supervisor API require setting `ENG_ML_INFERENCE_TOKEN` (or `DATABRICKS_TOKEN` pointed at a workspace with AI Gateway enabled):

```bash
ENG_ML_INFERENCE_TOKEN=dapi... uv run pytest tests/ -v
```
