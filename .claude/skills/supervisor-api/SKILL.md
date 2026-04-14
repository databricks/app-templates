---
name: supervisor-api
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
        "type": "genie_space",
        "genie_space": {
            "description": "Query sales data using natural language",
            "id": "<genie-space-id>",
        },
    },
    # UC function — SQL or Python UDF
    {
        "type": "uc_function",
        "uc_function": {
            "name": "<catalog>.<schema>.<function_name>",
            "description": "Executes a custom UC function",
        },
    },
    # Knowledge Assistant agent endpoint
    {
        "type": "knowledge_assistant",
        "knowledge_assistant": {
            "description": "A Knowledge Assistant agent",
            "knowledge_assistant_id": "<ka-id>",
        },
    },
    # MCP server via UC connection
    {
        "type": "connection",
        "connection": {
            "description": "An MCP server via UC connection",
            "name": "<uc-connection-name>",
        },
    },
    # Databricks Apps MCP server
    {
        "type": "app",
        "app": {
            "description": "An MCP server running as a Databricks App",
            "name": "<databricks-app-name>",
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
| `genie_space` | `genie_space` with `CAN_RUN` |
| `uc_function` | `uc_securable` (FUNCTION) with `EXECUTE` |
| `knowledge_assistant` | `serving_endpoint` with `CAN_QUERY` |
| `connection` | `uc_securable` (CONNECTION) with `USE_CONNECTION` |
| `app` | *(Databricks App access)* |

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
databricks bundle deploy && databricks bundle run {{BUNDLE_NAME}}  # Deploy
```

## MCP Server Tools: Multi-Turn Approval Flow

When using MCP server tools (`connection` or `app`), the Supervisor API does **not** execute the MCP tool call in a single request. Instead, it returns a `completed` response containing `mcp_approval_request` output items. To complete the tool call, your agent must handle a multi-turn flow:

1. **First request** — `responses.create()` → response completes with `mcp_approval_request` items in the output
2. **Return to frontend** — the `mcp_approval_request` item is returned to the chat UI so the user can approve the tool call
3. **Second request** — user approves → frontend sends a new request with the original input + `mcp_approval_request` + `mcp_approval_response` (with `approve: true`) appended to the input
4. **Result** — the second response completes with the actual `function_call_output` (tool result) and the final assistant `message`

No special backend handling is needed — the agent server simply returns all output items (including `mcp_approval_request`) to the frontend. The multi-turn flow is handled naturally through the conversation: each request/response is a separate `responses.create()` call.

**Example input for the follow-up request (step 3):**
```python
input = [
    # Original user message
    {"type": "message", "role": "user", "content": "Search for Databricks"},
    # The mcp_approval_request from the first response's output
    {"type": "mcp_approval_request", "id": "call_xxx", "name": "web-search",
     "server_label": "you_dot_com", "arguments": '{"query": "Databricks"}'},
    # The approval
    {"type": "mcp_approval_response", "id": "call_xxx",
     "approval_request_id": "call_xxx", "approve": True},
]
```

## Troubleshooting

**"Please ensure AI Gateway V2 is enabled"** — AI Gateway must be enabled for the workspace. Contact your Databricks account team.

**"Cannot mix hosted and client-side tools"** — Remove any `function`-type tools (Python callables) from `TOOLS`. All tools must be hosted types (`genie_space`, `uc_function`, `knowledge_assistant`, `connection`, `app`).

**"Parameter not supported when tools are provided"** — Remove `temperature`, `top_p`, or other inference parameters from the `responses.create()` call.

## Background Mode (Long-Running Tasks)

If your agent needs to run long-running tasks that may exceed HTTP timeout limits (e.g., complex multi-tool workflows, large data analysis), you can enable **background mode**. This submits the request asynchronously, polls for completion, and streams the result back to the frontend.

See the **supervisor-api-background-mode** skill for full implementation details.
