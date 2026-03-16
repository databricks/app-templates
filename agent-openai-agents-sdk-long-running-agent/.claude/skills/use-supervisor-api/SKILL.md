---
name: use-supervisor-api
description: "Replace the client-side agent loop with Databricks Supervisor API (hosted tools). Use when: (1) User asks about Supervisor API, (2) User wants Databricks to run the agent loop server-side, (3) Connecting Genie spaces, UC functions, agent endpoints, or MCP servers as hosted tools."
---

# Use the Databricks Supervisor API

> **Beta Feature:** The Supervisor API requires **AI Gateway (Beta) preview** to be enabled in your workspace. Contact your Databricks account team if it's not available.

The Supervisor API lets Databricks run the tool-selection and synthesis loop server-side. Instead of your agent calling tools and looping, you declare hosted tools and call `responses.create()` — Databricks handles the rest.

## When to Use

Use the Supervisor API when you want Databricks to manage the full agent loop (tool calls, retries, synthesis) for hosted tools: Genie spaces, UC functions, agent endpoints, or MCP servers via UC connections.

**Limitations (Beta):**
- Usage tracking is not supported
- Cannot mix hosted tools with client-side function tools in the same request
- Inference parameters (e.g., `temperature`, `top_p`) are not supported when tools are passed

## Step 1: Install `databricks-openai`

Add to `pyproject.toml` if not already present:

```toml
[project]
dependencies = [
    ...
    "databricks-openai>=0.9.0",
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
    # Agent endpoint — delegates to another agent
    {
        "type": "agent_endpoint",
        "agent_endpoint": {
            "name": "my-sub-agent",
            "description": "A specialized sub-agent",
            "endpoint_name": "<serving-endpoint-name>",
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

```python
import re

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


def _get_client() -> DatabricksOpenAI:
    """Create a DatabricksOpenAI client pointed at the AI Gateway."""
    wc = WorkspaceClient()
    host = wc.config.host  # e.g. https://my-workspace.cloud.databricks.com
    workspace_id = wc.get_workspace_id()
    domain = re.match(r"https://[^.]+\.(.+)", host).group(1)
    base_url = f"https://{workspace_id}.ai-gateway.{domain}/mlflow/v1"
    return DatabricksOpenAI(workspace_client=wc, base_url=base_url)


@invoke()
def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    mlflow.update_current_trace(
        metadata={"mlflow.trace.session": request.context.conversation_id}
    )
    response = _get_client().responses.create(
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
    return _get_client().responses.create(
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
| `genie` | `genie_space` with `CAN_RUN` |
| `uc_function` | `uc_securable` (FUNCTION) with `EXECUTE` |
| `agent_endpoint` | `serving_endpoint` with `CAN_QUERY` |
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
databricks bundle deploy && databricks bundle run agent_openai_agents_sdk_long_running_agent  # Deploy
```

## Troubleshooting

**"AI Gateway not available"** — Enable AI Gateway (Beta) preview in workspace settings, or contact your Databricks account team.

**"Cannot mix hosted and client-side tools"** — Remove any `function`-type tools (Python callables) from `TOOLS`. All tools must be hosted types (`genie`, `uc_function`, `agent_endpoint`, `mcp`).

**"Parameter not supported when tools are provided"** — Remove `temperature`, `top_p`, or other inference parameters from the `responses.create()` call.
