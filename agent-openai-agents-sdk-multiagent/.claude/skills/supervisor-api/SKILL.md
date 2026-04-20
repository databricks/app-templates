---
name: supervisor-api
description: "Replace the client-side agent loop with Databricks Supervisor API (hosted tools). Use when: (1) User asks about Supervisor API, (2) User wants Databricks to run the agent loop server-side, (3) Connecting Genie spaces, UC functions, agent endpoints, or MCP servers as hosted tools."
---

# Use the Databricks Supervisor API

The Supervisor API lets Databricks run the tool-selection and synthesis loop server-side. Instead of your agent managing tool calls and looping, you declare hosted tools and call `responses.create()` — Databricks handles the rest.

## When to Use

Use the Supervisor API when you want to:
- Connect Genie spaces, UC functions, Knowledge Assistants, or MCP servers without managing the agent loop yourself
- Choose models at runtime and control which tools are used per request
- Offload tool orchestration to Databricks while iterating on your agent

**Limitations:**
- Cannot mix hosted tools with client-side function tools in the same request
- Inference parameters (e.g., `temperature`, `top_p`) are not supported when tools are passed
- Scoped token access (OBO) is not supported — tools run as the app's service principal; grant tool permissions in `databricks.yml`
- `stream` and `background` cannot both be `true` in the same request
- Background mode requests have a maximum execution time of 30 minutes

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
            "id": "<genie-space-id>",
            "description": "Query sales data using natural language",
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
            "knowledge_assistant_id": "<ka-id>",
            "description": "Answers questions from internal documentation",
        },
    },
    # External MCP server via Unity Catalog connection
    {
        "type": "uc_connection",
        "uc_connection": {
            "name": "<uc-connection-name>",
            "description": "Searches the web for current information",
        },
    },
    # Databricks App endpoint or custom MCP server running as a Databricks App
    {
        "type": "app",
        "app": {
            "name": "<databricks-app-name>",
            "description": "Custom application or MCP server endpoint",
        },
    },
]
```

## Step 3: Update `agent_server/agent.py`

Replace your existing invoke/stream handlers with the Supervisor API pattern. Remove any MCP client setup, LangGraph agents, or OpenAI Agents SDK runner code — the Supervisor API replaces the client-side loop entirely.

`use_ai_gateway=True` automatically resolves the correct AI Gateway endpoint for the workspace.

Tools run as the app's service principal — grant each tool's resource permissions in `databricks.yml` (Step 4).

```python
import mlflow
from databricks.sdk import WorkspaceClient
from databricks_openai import DatabricksOpenAI
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
)

mlflow.openai.autolog()

MODEL = "databricks-claude-sonnet-4-5"
TOOLS = [...]  # From Step 2

# Resolve and cache the AI Gateway client once at module load
_wc = WorkspaceClient()
_client = DatabricksOpenAI(workspace_client=_wc, use_ai_gateway=True)


@invoke()
def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    mlflow.update_current_trace(
        metadata={"mlflow.trace.session": request.context.conversation_id}
    )
    response = _client.responses.create(
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
    return _client.responses.create(
        model=MODEL,
        input=[i.model_dump() for i in request.input],
        tools=TOOLS,
        stream=True,
    )
```

## Step 4: Grant Permissions in `databricks.yml`

For each hosted tool, grant the corresponding resource access. See the **add-tools** skill for complete YAML examples.

| Tool type | Resource to grant |
|-----------|-------------------|
| `genie_space` | `genie_space` with `CAN_RUN` |
| `uc_function` | `uc_securable` (FUNCTION) with `EXECUTE` |
| `knowledge_assistant` | `serving_endpoint` with `CAN_QUERY` |
| `uc_connection` | `uc_securable` (CONNECTION) with `USE_CONNECTION` |
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

## Supported Models

Pass any of these as the `model` parameter:

| Model | ID |
|-------|----|
| Claude Sonnet 4 | `databricks-claude-sonnet-4` |
| Claude Sonnet 4.5 | `databricks-claude-sonnet-4-5` |
| Claude Sonnet 4.6 | `databricks-claude-sonnet-4-6` |
| Claude Haiku 4.5 | `databricks-claude-haiku-4-5` |
| Claude Opus 4.1 | `databricks-claude-opus-4-1` |
| Claude Opus 4.5 | `databricks-claude-opus-4-5` |
| Claude Opus 4.6 | `databricks-claude-opus-4-6` |
| GPT-5 | `databricks-gpt-5` |

## Enabling Tracing

Pass `trace_destination` via `extra_body` to write a full agent loop trace to Unity Catalog tables:

```python
response = _client.responses.create(
    model=MODEL,
    input=[i.model_dump() for i in request.input],
    tools=TOOLS,
    stream=False,
    extra_body={
        "trace_destination": {
            "catalog_name": "<catalog>",
            "schema_name": "<schema>",
            "table_prefix": "<table-prefix>",
        }
    },
)
```

To also return the trace in the response, add `"databricks_options": {"return_trace": True}` to `extra_body`.

## MCP Server Tools: Multi-Turn Approval Flow

When using MCP server tools (`uc_connection` or `app`), the Supervisor API does **not** execute the MCP tool call in a single request. Instead, it returns a `completed` response containing `mcp_approval_request` output items. To complete the tool call, your agent must handle a multi-turn flow:

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

**"Cannot mix hosted and client-side tools"** — Remove any `function`-type tools (Python callables) from `TOOLS`. All tools must be hosted types (`genie_space`, `uc_function`, `knowledge_assistant`, `uc_connection`, `app`).

**"Parameter not supported when tools are provided"** — Remove `temperature`, `top_p`, or other inference parameters from the `responses.create()` call.

## Background Mode (Long-Running Tasks)

If your agent needs to run long-running tasks that may exceed HTTP timeout limits (e.g., complex multi-tool workflows, large data analysis), you can enable **background mode**. This submits the request asynchronously, polls for completion, and streams the result back to the frontend.

See the **supervisor-api-background-mode** skill for full implementation details.
