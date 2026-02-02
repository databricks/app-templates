# Model Serving to Databricks Apps Migration Guide

This guide instructs LLM coding agents how to migrate an MLflow ResponsesAgent from Databricks Model Serving to Databricks Apps.

---

## Overview

**Goal:** Migrate an agent deployed on Databricks Model Serving (using `ResponsesAgent` with `predict()`/`predict_stream()`) to Databricks Apps (using MLflow GenAI Server with `@invoke`/`@stream` decorators).

**Key Transformation:**
- Model Serving: Synchronous `predict()` and `predict_stream()` methods on a class
- Apps: Asynchronous `@invoke` and `@stream` decorated functions

---

## Step 0: Verify Databricks Authentication

Before starting the migration, verify you have valid authentication to the correct Databricks workspace.

### 0.1 List Available Profiles

```bash
databricks auth profiles
```

This shows all configured profiles and their authentication status.

### 0.2 Select or Confirm Profile

Ask the user which profile to use for the migration. If the user provides an endpoint URL, extract the workspace host to help identify the correct profile.

**Example interaction:**
> "I see you have the following Databricks profiles configured:
> 1. DEFAULT (https://myworkspace.cloud.databricks.com)
> 2. prod (https://prod.cloud.databricks.com)
>
> Which profile corresponds to your Model Serving endpoint? (Enter number or profile name)"

### 0.3 Validate Authentication

Test that the selected profile has a valid OAuth token:

```bash
databricks current-user me --profile <selected-profile>
```

If this fails with an authentication error, prompt the user to re-authenticate:

```bash
databricks auth login --profile <selected-profile>
```

Or if they need to authenticate to a new workspace:

```bash
databricks auth login --host <workspace-url>
```

### 0.4 Set Profile for Migration

Once validated, use this profile for ALL subsequent `databricks` CLI commands by adding `--profile <selected-profile>`.

> **Important:** Remember to include `--profile <profile-name>` on every `databricks` CLI command throughout the migration, or set `export DATABRICKS_CONFIG_PROFILE=<profile-name>` in your environment.

---

## Step 1: Get the Original Agent Code

First, download the original agent code from the Model Serving endpoint.

> **Use the `/download-mlflow-model` skill** to set up a virtual environment with the required dependencies and download the model artifacts. This handles MLflow installation and authentication automatically.

Alternatively, if you already have MLflow installed:

```bash
# Get the endpoint info to find the model URI
databricks serving-endpoints get <endpoint-name> --output json

# The response contains served_entities[0].entity_name (model name) and entity_version
# Download the model artifacts using MLflow Python (requires mlflow package)
python3 -c "import mlflow; mlflow.set_tracking_uri('databricks'); mlflow.artifacts.download_artifacts(artifact_uri='models:/<model-name>/<version>', dst_path='./original_model')"
```

The original agent code is typically in:
- `./original_model/code/agent.py` or
- `./original_model/agent.py`

---

## Step 2: Choose a Template from app-templates

Browse the templates at **https://github.com/databricks/app-templates** and choose one similar to your agent:

| If your agent uses... | Use this template |
|-----------------------|-------------------|
| Basic stateless agent | `agent-langgraph` |
| Short-term memory (checkpointer, `AsyncCheckpointSaver`) | `agent-langgraph-short-term-memory` |
| Long-term memory (store, `AsyncDatabricksStore`) | `agent-langgraph-long-term-memory` |
| Non-conversational (single response) | `agent-non-conversational` |
| OpenAI Agents SDK | `agent-openai-agents-sdk` |

**Clone the template:**

```bash
# Clone the specific template folder
git clone --depth 1 --filter=blob:none --sparse https://github.com/databricks/app-templates.git
cd app-templates
git sparse-checkout set <template-name>
cd <template-name>
```

Or copy from an existing local clone of app-templates.

---

## Step 3: Understand the Key Transformations

### Entry Point Transformation

**Model Serving (OLD):**
```python
from mlflow.pyfunc import ResponsesAgent, ResponsesAgentRequest, ResponsesAgentResponse

class MyAgent(ResponsesAgent):
    def predict(self, request: ResponsesAgentRequest, params=None) -> ResponsesAgentResponse:
        # Synchronous implementation
        ...
        return ResponsesAgentResponse(output=outputs)

    def predict_stream(self, request: ResponsesAgentRequest, params=None):
        # Synchronous generator
        for chunk in ...:
            yield ResponsesAgentStreamEvent(...)
```

**Apps (NEW):**
```python
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

@invoke()
async def non_streaming(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    # Async implementation - typically calls streaming() and collects results
    outputs = [
        event.item
        async for event in streaming(request)
        if event.type == "response.output_item.done"
    ]
    return ResponsesAgentResponse(output=outputs)

@stream()
async def streaming(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # Async generator
    async for event in ...:
        yield event
```

### Key Differences

| Aspect | Model Serving | Apps |
|--------|--------------|------|
| Class vs Functions | `class MyAgent(ResponsesAgent)` | Decorated functions `@invoke()`, `@stream()` |
| Sync vs Async | `def predict()` | `async def non_streaming()` |
| Streaming | `def predict_stream()` (sync generator) | `async def streaming()` (async generator) |
| Server | MLflow Model Server | MLflow GenAI Server (FastAPI) |
| Deployment | `databricks_agents.deploy()` | `databricks apps deploy` |

### Async Patterns

All I/O operations must be async:

```python
# OLD (sync)
response = client.chat(messages)

# NEW (async)
response = await client.achat(messages)

# OLD (sync iteration)
for chunk in stream:
    yield chunk

# NEW (async iteration)
async for chunk in stream:
    yield chunk
```

---

## Step 4: Migrate the Agent Code

### 4.1 Copy Your Configuration

From the original agent, extract and preserve:
- **LLM endpoint name** (e.g., `databricks-claude-sonnet-4-5`)
- **System prompt**
- **Tool definitions**
- **Any custom logic**

### 4.2 Update the Template's agent.py

Edit `agent_server/agent.py` in your chosen template:

1. **Update the LLM endpoint:**
   ```python
   LLM_ENDPOINT_NAME = "<your-endpoint-from-original>"
   ```

2. **Update the system prompt:**
   ```python
   SYSTEM_PROMPT = """<your-system-prompt-from-original>"""
   ```

3. **Add your custom tools:**
   If your original agent had custom tools, add them:
   ```python
   from langchain_core.tools import tool

   @tool
   async def my_custom_tool(arg: str) -> str:
       """Tool description."""
       # Your tool logic (make async if needed)
       return result
   ```

4. **Preserve any special logic:**
   Migrate any custom preprocessing, postprocessing, or business logic from the original agent.

### 4.3 Handle Stateful Agents

**If original uses checkpointer (short-term memory):**
- Use `agent-langgraph-short-term-memory` template
- Configure `LAKEBASE_INSTANCE_NAME` in `.env`
- The template handles thread_id extraction from `request.custom_inputs` or `request.context.conversation_id`

**If original uses store (long-term memory):**
- Use `agent-langgraph-long-term-memory` template
- Configure `LAKEBASE_INSTANCE_NAME` in `.env`
- The template handles user_id extraction from `request.custom_inputs` or `request.context.user_id`

---

## Step 5: Set Up the App

### 5.1 Install Dependencies

```bash
cd <your-app-directory>
uv sync
```

### 5.2 Create requirements.txt for Databricks Apps

Databricks Apps requires a `requirements.txt` file with `uv` to install dependencies from `pyproject.toml`:

```bash
echo "uv" > requirements.txt
```

### 5.3 Run Quickstart (if available)

```bash
uv run quickstart
```

This will:
- Set up Databricks authentication
- Create an MLflow experiment
- Configure `.env.local`

### 5.4 Configure Environment

If your agent needs additional environment variables, add them to `.env.local`:

```bash
# Example: Lakebase for stateful agents
LAKEBASE_INSTANCE_NAME=<your-lakebase-instance>

# Example: Custom API keys
MY_API_KEY=<value>
```

---

## Step 6: Test Locally

> Test your migrated agent locally before deploying to Databricks Apps. This helps catch configuration issues early and ensures the agent works correctly.

### 6.1 Start the Server

```bash
uv run start-app
```

Wait for the server to start. You should see output indicating the server is running on `http://localhost:8000`.

### 6.2 Test with Original Input Example

The original model artifacts include an `input_example.json` file that contains a sample request. Use this to verify your migrated agent produces the same behavior. If there's no valid sample request then figure out a valid sample request to query agent based on its code.

```bash
# Check the original input example
cat ./original_model/input_example.json
```

Example content:
```json
{"input": [{"role": "user", "content": "What is an LLM agent?"}], "custom_inputs": {"thread_id": "example-thread-123"}}
```

Test your local server with this input:

```bash
# Test with the original input example
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d "$(cat ./original_model/input_example.json)"
```

### 6.3 Test Basic Requests

```bash
# Non-streaming
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hello!"}]}'

# Streaming
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hello!"}], "stream": true}'
```

### 6.4 Test with Custom Inputs (for stateful agents)

```bash
# With thread_id for short-term memory
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hi"}], "custom_inputs": {"thread_id": "test-123"}}'

# With user_id for long-term memory
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hi"}], "custom_inputs": {"user_id": "user@example.com"}}'
```

### 6.5 Verify Before Proceeding

Before proceeding to deployment, ensure:
- [ ] The server starts without errors
- [ ] The original input example returns a valid response
- [ ] Streaming responses work correctly
- [ ] Custom inputs (thread_id, user_id) are handled properly (if applicable)

> **Note:** Only proceed to Step 7 (Deploy) after confirming the agent works correctly locally.

---

## Step 7: Deploy to Databricks Apps

### 7.1 Extract Resources from Original Model

The original model's `MLmodel` file contains a `resources` section that lists all Databricks resources the agent needs access to. Check `./original_model/MLmodel` for content like:

```yaml
resources:
  api_version: '1'
  databricks:
    lakebase:
    - name: lakebase
    serving_endpoint:
    - name: databricks-claude-sonnet-4-5
```

### 7.2 Create the App with Resources

Convert the MLmodel resources to the Databricks Apps API format and pass them via `--json`.

**Resource Type Mapping (MLmodel → Apps API):**

| MLmodel Resource | Apps API Resource Type | Key Fields |
|------------------|------------------------|------------|
| `serving_endpoint` | `serving_endpoint` | `name`, `permission` (CAN_MANAGE, CAN_QUERY, CAN_VIEW) |
| `lakebase` | `database` | `instance_name`, `permission` (CAN_CONNECT_AND_CREATE) |
| `vector_search_index` | `uc_securable` | `securable_full_name`, `securable_type`: TABLE, `permission`: SELECT |
| `function` | `uc_securable` | `securable_full_name`, `securable_type`: FUNCTION, `permission`: EXECUTE |
| `table` | `uc_securable` | `securable_full_name`, `securable_type`: TABLE, `permission`: SELECT |
| `uc_connection` | `uc_securable` | `securable_full_name`, `securable_type`: CONNECTION, `permission`: USE_CONNECTION |
| `sql_warehouse` | `sql_warehouse` | `id`, `permission` (CAN_MANAGE, CAN_USE, IS_OWNER) |
| `genie_space` | `genie_space` | `space_id`, `permission` (CAN_MANAGE, CAN_EDIT, CAN_RUN, CAN_VIEW) |
| `app` | `app` | `name`, `permission` (CAN_USE) |

**Important:** When using `--json`, do NOT include the app name as a positional argument—put it inside the JSON only.

**Example with serving endpoint and UC function (e.g., python_exec):**

```bash
# Correct: app name is ONLY in the JSON when you pass resources in
databricks apps create --json '{
  "name": "my-mcp-agent",
  "resources": [
    {
      "name": "serving-endpoint",
      "serving_endpoint": {
        "name": "databricks-claude-sonnet-4-5",
        "permission": "CAN_QUERY"
      }
    },
    {
      "name": "python-exec",
      "uc_securable": {
        "securable_full_name": "system.ai.python_exec",
        "securable_type": "FUNCTION",
        "permission": "EXECUTE"
      }
    }
  ]
}'
```

**Example with Lakebase (for stateful agents):**

```bash
databricks apps create --json '{
  "name": "demo-short-term-memory-agent",
  "resources": [
    {
      "name": "serving-endpoint",
      "serving_endpoint": {
        "name": "databricks-claude-sonnet-4-5",
        "permission": "CAN_QUERY"
      }
    },
    {
      "name": "database",
      "database": {
        "instance_name": "lakebase",
        "permission": "CAN_CONNECT_AND_CREATE"
      }
    },
    {
      "name": "experiment",
      "experiment": {
        "experiment_id": "1234567890",
        "permission": "CAN_MANAGE"
      }
    }
  ]
}'
```

> **Note:** Always refer to [MLflow resources.py](https://github.com/mlflow/mlflow/blob/master/mlflow/models/resources.py) for the full list of MLmodel resource types and the [Apps API documentation](https://docs.databricks.com/api/workspace/apps/create) for the correct resource field names and permissions.

### 7.3 Sync Files

**IMPORTANT:** Run the sync command from INSIDE the app directory, using `.` as the source.

```bash
# Get your username
DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)

# Change into the app directory first
cd <app-name>

# Sync current directory (.) to workspace
databricks sync . "/Users/$DATABRICKS_USERNAME/<app-name>"
```

### 7.4 Deploy

```bash
databricks apps deploy <app-name> --source-code-path /Workspace/Users/$DATABRICKS_USERNAME/<app-name>
```

### 7.5 Test Deployed App

```bash
# Get OAuth token
TOKEN=$(databricks auth token | jq -r .access_token)

# Query the app
curl -X POST <app-url>/invocations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hello!"}]}'
```

---

## Reference: App File Structure

```
<app-name>/
├── agent_server/
│   ├── __init__.py
│   ├── agent.py          # Main agent logic - THIS IS WHERE YOU MIGRATE TO
│   ├── start_server.py   # FastAPI server setup
│   ├── utils.py          # Helper utilities
│   └── evaluate_agent.py # Agent evaluation
├── scripts/
│   ├── __init__.py
│   ├── quickstart.py     # Setup script
│   └── start_app.py      # App startup
├── app.yaml              # Databricks Apps configuration
├── pyproject.toml        # Dependencies (for local dev with uv)
├── requirements.txt      # REQUIRED: Must contain "uv" for Databricks Apps
├── .env.example          # Environment template
└── README.md
```

> **IMPORTANT:** The `requirements.txt` file must exist and contain `uv` so that Databricks Apps can install dependencies using the `pyproject.toml`. Without this file, the app will fail to start.

---

## Reference: Common Migration Patterns

### Pattern 1: Simple Chat Agent

**Original:**
```python
class ChatAgent(ResponsesAgent):
    def predict(self, request, params=None):
        messages = to_chat_completions_input(request.input)
        response = self.llm.invoke(messages)
        return ResponsesAgentResponse(output=[...])
```

**Migrated:**
```python
@invoke()
async def non_streaming(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    outputs = [e.item async for e in streaming(request) if e.type == "response.output_item.done"]
    return ResponsesAgentResponse(output=outputs)

@stream()
async def streaming(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    messages = {"messages": to_chat_completions_input([i.model_dump() for i in request.input])}
    agent = await init_agent()
    async for event in process_agent_astream_events(agent.astream(messages, stream_mode=["updates", "messages"])):
        yield event
```

### Pattern 2: Agent with Custom Tools

Migrate tools to async LangChain tools:

```python
from langchain_core.tools import tool

@tool
async def search_docs(query: str) -> str:
    """Search the documentation."""
    # Make async calls
    results = await vector_store.asimilarity_search(query)
    return format_results(results)
```

### Pattern 3: Using LangGraph with create_agent

```python
from langchain.agents import create_agent
from databricks_langchain import ChatDatabricks

async def init_agent():
    tools = await mcp_client.get_tools()  # MCP tools are async
    model = ChatDatabricks(endpoint=LLM_ENDPOINT_NAME)
    return create_agent(model=model, tools=tools, system_prompt=SYSTEM_PROMPT)
```

---

## Reference: Useful Resources

- **App Templates:** https://github.com/databricks/app-templates
- **Responses API Docs:** https://mlflow.org/docs/latest/genai/serving/responses-agent/
- **Agent Framework:** https://docs.databricks.com/aws/en/generative-ai/agent-framework/
- **Agent Tools:** https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool
- **databricks-langchain SDK:** https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/langchain

---

## Troubleshooting

### "Module not found" errors
```bash
uv sync  # Reinstall dependencies
```

### Authentication errors
```bash
databricks auth login  # Re-authenticate
```

### Lakebase permission errors
- Ensure the Lakebase instance is added as an app resource in Databricks UI
- Grant appropriate permissions on the Lakebase instance

### Async errors
- Ensure all I/O calls use async versions (e.g., `await client.achat()` not `client.chat()`)
- Use `async for` instead of `for` when iterating async generators
