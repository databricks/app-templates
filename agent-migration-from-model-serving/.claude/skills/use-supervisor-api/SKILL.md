---
name: use-supervisor-api
description: "Replace the client-side agent loop with Databricks Supervisor API (hosted tools). Use when: (1) User asks about Supervisor API, (2) User wants Databricks to run the agent loop server-side, (3) Connecting Genie spaces, UC functions, agent endpoints, or MCP servers as hosted tools."
---

# Use the Databricks Supervisor API

The Supervisor API lets Databricks run the tool-selection and synthesis loop server-side. Instead of your agent managing tool calls and looping, you declare hosted tools and call `responses.create()` — Databricks handles the rest.

## When to Use

Use the Supervisor API when you want Databricks to manage the full agent loop for hosted tools: Genie spaces, UC functions, KA (Knowledge Assistant) agent endpoints, or MCP servers via UC connections.

**Limitations:**
- Cannot mix hosted tools with client-side function tools in the same request
- Inference parameters (e.g., `temperature`, `top_p`) are not supported when tools are passed

## Step 1: Install `databricks-openai`

Add to `pyproject.toml` if not already present:

```toml
[project]
dependencies = [
    ...
    "databricks-openai>=0.14.0",
    "databricks-sdk>=0.55.0",
]
```

Then run `uv sync`.

## Step 2: Declare Hosted Tools

Define your tools as a list of dicts. Run `uv run discover-tools` to find available resources in your workspace.

```python
TOOLS = [
    # Genie space — natural language queries over structured data
    {
        "type": "genie",
        "genie": {
            "name": "my-genie-space",
            "description": "Query sales data using natural language",
            "space_id": "<genie-space-id>",
        },
    },
    # UC function — SQL or Python UDF
    {
        "type": "uc_function",
        "uc_function": {
            "name": "<catalog>.<schema>.<function_name>",
            "name_alias": "my_function",
            "description": "Executes a custom UC function",
        },
    },
    # KA (Knowledge Assistant) endpoint — delegates to a Knowledge Assistant agent
    # Note: agent_endpoint only supports KA endpoints, not arbitrary agent serving endpoints.
    # KA endpoints use a specific ka_query protocol; regular LangGraph/OpenAI agents do not.
    {
        "type": "agent_endpoint",
        "agent_endpoint": {
            "name": "my-ka-agent",
            "description": "A Knowledge Assistant agent",
            "endpoint_name": "<ka-serving-endpoint-name>",
        },
    },
    # MCP server via UC connection
    {
        "type": "mcp",
        "mcp": {
            "name": "my-mcp-server",
            "description": "An external MCP server",
            "connection_name": "<uc-connection-name>",
        },
    },
]
```

## Step 3: Update `agent_server/agent.py`

Replace your existing invoke/stream handlers with the Supervisor API pattern. Remove any MCP client setup, LangGraph agents, or OpenAI Agents SDK runner code — the Supervisor API replaces the client-side loop entirely.

`use_ai_gateway=True` automatically resolves the correct AI Gateway endpoint for the workspace.

When deployed on Databricks Apps, the platform forwards the authenticated user's token via `x-forwarded-access-token`. Pass this to the Supervisor API so tool calls (e.g., Genie queries) run on behalf of the user rather than the app's service principal.

```python
import mlflow
from databricks.sdk import WorkspaceClient
from databricks.sdk.config import Config
from databricks_openai import DatabricksOpenAI
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
)

mlflow.openai.autolog()

MODEL = "databricks-claude-sonnet-4-5"
TOOLS = [...]  # From Step 2

# Resolve and cache the AI Gateway URL once at module load
_wc = WorkspaceClient()
_client = DatabricksOpenAI(workspace_client=_wc, use_ai_gateway=True)
_ai_gateway_base_url = str(_client.base_url)


def _get_client(obo_token: str | None = None) -> DatabricksOpenAI:
    """Return a client using the OBO token if provided, else service principal."""
    if obo_token:
        obo_wc = WorkspaceClient(
            config=Config(host=_wc.config.host, token=obo_token)
        )
        return DatabricksOpenAI(workspace_client=obo_wc, base_url=_ai_gateway_base_url)
    return _client


def _obo_token(request: ResponsesAgentRequest) -> str | None:
    return (request.custom_inputs or {}).get("x-forwarded-access-token")


@invoke()
def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    mlflow.update_current_trace(
        metadata={"mlflow.trace.session": request.context.conversation_id}
    )
    response = _get_client(_obo_token(request)).responses.create(
        model=MODEL,
        input=[i.model_dump() for i in request.input],
        tools=TOOLS,
        stream=False,
    )
    return ResponsesAgentResponse(output=[item.model_dump() for item in response.output])


@stream()
def stream_handler(request: ResponsesAgentRequest):
    mlflow.update_current_trace(
        metadata={"mlflow.trace.session": request.context.conversation_id}
    )
    return _get_client(_obo_token(request)).responses.create(
        model=MODEL,
        input=[i.model_dump() for i in request.input],
        tools=TOOLS,
        stream=True,
    )
```

> **OBO note:** The `x-forwarded-access-token` is injected into `custom_inputs` by the app server middleware. No changes are needed to the client — the token arrives automatically when users call your deployed app.

## Step 4: Grant Permissions in `databricks.yml`

For each hosted tool, grant the corresponding resource access. See the **add-tools** skill for complete YAML examples.

| Tool type | Resource to grant |
|-----------|-------------------|
| `genie` | `genie_space` with `CAN_RUN` |
| `uc_function` | `uc_securable` (FUNCTION) with `EXECUTE` |
| `agent_endpoint` | `serving_endpoint` with `CAN_QUERY` (KA endpoints only) |
| `mcp` | `uc_securable` (CONNECTION) with `USE_CONNECTION` |

Also grant `CAN_QUERY` on the `MODEL` serving endpoint:

```yaml
- name: 'model-endpoint'
  serving_endpoint:
    name: 'databricks-claude-sonnet-4-5'
    permission: 'CAN_QUERY'
```

## Step 5: Test and Deploy

```bash
uv run start-app       # Test locally
databricks bundle deploy && databricks bundle run agent_migration  # Deploy
```

## Troubleshooting

**"Please ensure AI Gateway V2 is enabled"** — AI Gateway must be enabled for the workspace. Contact your Databricks account team.

**"Cannot mix hosted and client-side tools"** — Remove any `function`-type tools (Python callables) from `TOOLS`. All tools must be hosted types (`genie`, `uc_function`, `agent_endpoint`, `mcp`).

**"Parameter not supported when tools are provided"** — Remove `temperature`, `top_p`, or other inference parameters from the `responses.create()` call.
