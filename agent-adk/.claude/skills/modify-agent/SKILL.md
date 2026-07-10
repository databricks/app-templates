---
name: modify-agent
description: "Modify agent code, add tools, or change configuration. Use when: (1) User says 'modify agent', 'add tool', 'change model', or 'edit agent.py', (2) Adding MCP servers to agent, (3) Changing agent instructions, (4) Understanding SDK patterns."
---

# Modify the Agent

This template's agent is built with **Google's Agent Development Kit (ADK)**. ADK talks to
Databricks Model Serving through **LiteLLM** (`google.adk.models.lite_llm.LiteLlm`), and the
MLflow `AgentServer` exposes it over the Responses API.

## Main File

**`agent_server/agent.py`** — Agent logic, model selection, instructions, tools

## Key Files

| File                             | Purpose                                             |
| -------------------------------- | --------------------------------------------------- |
| `agent_server/agent.py`          | Agent logic, model, instructions, tools             |
| `agent_server/start_server.py`   | FastAPI server + MLflow setup                       |
| `agent_server/evaluate_agent.py` | Agent evaluation with MLflow scorers                |
| `agent_server/utils.py`          | Auth helpers, session seeding, ADK→Responses adapter|
| `databricks.yml`                 | Bundle config & resource permissions                |

## SDK Setup

```python
import mlflow
from databricks.sdk import WorkspaceClient
from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm

# ADK drives the model via LiteLLM, so LiteLLM autolog captures every model call as a trace span.
mlflow.litellm.autolog()

workspace_client = WorkspaceClient()
```

Before making changes, confirm APIs exist in the installed `google-adk` package (look in the
venv's `site-packages/google/adk`, or run `uv sync` first). ADK's API changed between the 1.x
and 2.x lines; this template targets 2.x.

---

## Connecting to a Databricks model serving endpoint

`LiteLlm` with the `openai/` provider prefix points ADK at any OpenAI-compatible endpoint.
Databricks Model Serving exposes exactly such a surface at `{host}/serving-endpoints`.

```python
from google.adk.models.lite_llm import LiteLlm
from agent_server.utils import get_bearer_token, get_databricks_host

def build_model(workspace_client):
    host = get_databricks_host(workspace_client)
    token = get_bearer_token(workspace_client)   # works for CLI, PAT, and App OAuth creds
    return LiteLlm(
        model=f"openai/databricks-claude-sonnet-4-5",  # openai/<serving-endpoint-name>
        api_base=f"{host}/serving-endpoints",
        api_key=token,
        temperature=0.1,      # any extra kwargs pass through to LiteLLM
    )
```

Change `databricks-claude-sonnet-4-5` to any endpoint your app can query (e.g.
`databricks-gpt-5-2`, `databricks-meta-llama-3-3-70b-instruct`). Some workspaces require
granting the app access to the serving endpoint in `databricks.yml` — see the **add-tools**
skill and `examples/serving-endpoint.yaml`.

---

## Defining the agent and its instructions

Unlike LangGraph's `create_agent`, ADK's `LlmAgent` takes the system prompt directly via
`instruction`:

```python
from google.adk.agents import LlmAgent

AGENT_INSTRUCTIONS = """You are a helpful data analyst assistant.

You have access to:
- Company sales data via Genie
- Product documentation via vector search

Always cite your sources when answering questions."""

def create_agent(workspace_client):
    return LlmAgent(
        name="agent",                     # must be a valid identifier
        model=build_model(workspace_client),
        instruction=AGENT_INSTRUCTIONS,
        description="A helpful assistant.",
        tools=[get_current_time],
    )
```

---

## Function tools

ADK auto-wraps a plain Python function (with type hints + a docstring) into a tool — no
decorator needed. The docstring is shown to the model, so make it descriptive.

```python
def get_current_time() -> str:
    """Get the current date and time."""
    from datetime import datetime
    return datetime.now().isoformat()

# then: tools=[get_current_time, your_other_tool]
```

---

## MCP tools (UC functions, Genie, Vector Search, code interpreter)

Databricks-hosted tools are exposed over MCP. ADK connects to an MCP server with an
`MCPToolset`. This needs the `mcp` package — run `uv add "google-adk[extensions]"`.

```python
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
from agent_server.utils import get_bearer_token, get_databricks_host

def init_mcp_toolset(workspace_client):
    host = get_databricks_host(workspace_client)
    token = get_bearer_token(workspace_client)
    return MCPToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=f"{host}/api/2.0/mcp/functions/system/ai",   # UC functions in system.ai
            headers={"Authorization": f"Bearer {token}"},
        ),
    )
# then: tools.append(init_mcp_toolset(workspace_client))
```

Common Databricks MCP URLs (swap the path):

| Tool | URL path |
|------|----------|
| UC functions (schema) | `/api/2.0/mcp/functions/{catalog}/{schema}` |
| Genie space | `/api/2.0/mcp/genie/{space_id}` |
| Vector Search (schema) | `/api/2.0/mcp/vector-search/{catalog}/{schema}` |
| Built-in code interpreter | `/api/2.0/mcp/functions/system/ai` (`system.ai.python_exec`) |

**After adding MCP servers:** grant permissions in `databricks.yml` (see **add-tools** skill).

**Robustness note:** the base template runs the ADK agent per request. If you add an
`MCPToolset`, an unreachable/unauthorized MCP server can raise when ADK lists its tools inside
`runner.run_async`. Wrap the run in a `try/except` (log and continue) so one bad server doesn't
crash the request, and give slow servers (e.g. Genie) a longer `timeout`. Unlike the OpenAI
Agents SDK template, ADK has no built-in per-server health check — add one if you connect
multiple MCP servers.

---

## How requests flow (Responses API contract)

You normally don't edit this, but it helps to understand it:

- `stream_handler` (decorated `@stream()`) replays the client-carried conversation into a fresh
  ADK session via `seed_session_history()`, runs `runner.run_async(..., RunConfig(streaming_mode=SSE))`,
  and adapts ADK `Event`s into `ResponsesAgentStreamEvent`s with `process_adk_events()`.
- `invoke_handler` (decorated `@invoke()`) collects the `response.output_item.done` items from
  the same stream to build the non-streaming `ResponsesAgentResponse`.

To change the streamed shape, edit `process_adk_events()` in `agent_server/utils.py`.

---

## Session / memory

This template is stateless — the client sends the full history each turn. For durable
cross-session memory, back an ADK `DatabaseSessionService` with Lakebase Postgres
(see **lakebase-setup**), or use governed **managed-memory** tools.

---

## External Resources

1. [Google ADK documentation](https://google.github.io/adk-docs/)
2. [ADK + LiteLLM models](https://google.github.io/adk-docs/agents/models/)
3. [Agent Framework docs](https://docs.databricks.com/aws/en/generative-ai/agent-framework/)
4. [Adding tools](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool)
5. [Responses API](https://mlflow.org/docs/latest/genai/serving/responses-agent/)

## Next Steps

- Discover available tools: see **discover-tools** skill
- Grant resource permissions: see **add-tools** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
