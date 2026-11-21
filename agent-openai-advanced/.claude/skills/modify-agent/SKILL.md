---
name: modify-agent
description: "Modify agent code, add tools, or change configuration. Use when: (1) User says 'modify agent', 'add tool', 'change model', or 'edit agent.py', (2) Adding MCP servers to agent, (3) Changing agent instructions, (4) Understanding SDK patterns."
---

# Modify the Agent

## Main File

**`agent_server/agent.py`** - Agent logic, model selection, instructions, MCP servers

## Key Files

| File                             | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `agent_server/agent.py`          | Agent logic, model, instructions, MCP servers |
| `agent_server/start_server.py`   | FastAPI server + MLflow setup                 |
| `agent_server/evaluate_agent.py` | Agent evaluation with MLflow scorers          |
| `agent_server/utils.py`          | Databricks auth helpers, stream processing    |
| `databricks.yml`                 | Bundle config & resource permissions          |

## SDK Setup

```python
import mlflow
from databricks_openai import AsyncDatabricksOpenAI
from agents import set_default_openai_api, set_default_openai_client, Agent
from agents.tracing import set_trace_processors

# Set up async client (recommended for agent servers)
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")

# Use MLflow for tracing (disables SDK's built-in tracing)
set_trace_processors([])
mlflow.openai.autolog()
```

## Adding MCP Servers

```python
from databricks_openai.agents import McpServer

# UC Functions
uc_server = McpServer(
    url=f"{host}/api/2.0/mcp/functions/{catalog}/{schema}",
    name="uc functions",
)

# Genie Space
genie_server = McpServer(
    url=f"{host}/api/2.0/mcp/genie/{space_id}",
    name="genie space",
)

# Vector Search
vector_server = McpServer(
    url=f"{host}/api/2.0/mcp/vector-search/{catalog}/{schema}/{index}",
    name="vector search",
)

# Add to agent
agent = Agent(
    name="my agent",
    instructions="You are a helpful agent.",
    model="databricks-claude-3-7-sonnet",
    mcp_servers=[uc_server, genie_server, vector_server],
)
```

**After adding MCP servers:** Grant permissions in `databricks.yml` (see **add-tools** skill)

## Changing the Model

The agent's model comes from the `llm-endpoint` serving-endpoint resource in `databricks.yml` (and `app.yaml`), which sets the `LLM_MODEL` environment variable that `agent_server/agent.py` reads. To change the model, change that resource's `name`:

```yaml
- name: 'llm-endpoint'
  serving_endpoint:
    name: 'databricks-claude-sonnet-5-5'  # change here
    permission: 'CAN_QUERY'
```

This also grants the app's service principal permission to query the new endpoint, so there's nothing else to keep in sync. Check your workspace's **Serving** page for the endpoints available to you. For local runs, `agent.py` falls back to its default model; set `LLM_MODEL` in `.env` to try a different one. When creating the app in the Databricks UI, pick the endpoint for the `llm-endpoint` resource there.

## Changing Instructions

```python
agent = Agent(
    name="my agent",
    instructions="""You are a helpful data analyst assistant.

    You have access to:
    - Company sales data via Genie
    - Product documentation via vector search

    Always cite your sources when answering questions.""",
    ...
)
```

## Running the Agent

```python
from agents import Runner

# Non-streaming
messages = [{"role": "user", "content": "hi"}]
result = await Runner.run(agent, messages)

# Streaming
result = Runner.run_streamed(agent, input=messages)
async for event in result.stream_events():
    # Process stream events
    pass
```

**Converting to Responses API format:** Use `process_agent_stream_events()` from `agent_server/utils.py` to convert streaming output to Responses API compatible format:

```python
from agent_server.utils import process_agent_stream_events

result = Runner.run_streamed(agent, input=messages)
async for event in process_agent_stream_events(result.stream_events()):
    yield event  # Yields ResponsesAgentStreamEvent objects
```

## External Resources

1. [databricks-openai SDK](https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/openai)
2. [Agent examples](https://github.com/databricks/app-templates)
3. [Agent Framework docs](https://docs.databricks.com/aws/en/generative-ai/agent-framework/)
4. [Adding tools](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool)
5. [OpenAI Agents SDK](https://platform.openai.com/docs/guides/agents-sdk)
6. [Responses API](https://mlflow.org/docs/latest/genai/serving/responses-agent/)

## Next Steps

- Discover available tools: see **discover-tools** skill
- Grant resource permissions: see **add-tools** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
