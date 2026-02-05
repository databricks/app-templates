# Model Serving to Databricks Apps Migration Guide

This guide instructs LLM coding agents how to migrate an MLflow ResponsesAgent from Databricks Model Serving to Databricks Apps.

---

## Overview

**Goal:** Migrate an agent deployed on Databricks Model Serving (using `ResponsesAgent` with `predict()`/`predict_stream()`) to Databricks Apps (using MLflow GenAI Server with `@invoke`/`@stream` decorators).

**Key Transformation:**
- Model Serving: Synchronous `predict()` and `predict_stream()` methods on a class
- Apps: Asynchronous `@invoke` and `@stream` decorated functions

**Deliverables:** After migration is complete, you will have two folders:

```
<working-directory>/
├── original_mlflow_model/    # Downloaded artifacts from Model Serving
│   ├── MLmodel
│   ├── code/
│   │   └── agent.py
│   ├── input_example.json
│   └── requirements.txt
│
└── migrated_app/             # New Databricks App (ready to deploy)
    ├── agent_server/
    │   ├── agent.py          # Migrated agent code
    │   └── ...
    ├── app.yaml
    ├── pyproject.toml
    ├── requirements.txt
    └── ...
```

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

## Step 1: Download the Original Agent Code

Download the original agent code from the Model Serving endpoint. This requires setting up a virtual environment with MLflow to access the model artifacts.

### 1.1 Set Up the Migration Environment

Create and activate a virtual environment with the required dependencies:

```bash
# Create virtual environment
python3 -m venv .migration-venv

# Activate it
source .migration-venv/bin/activate

# Install dependencies (includes boto3 for S3/Unity Catalog access)
pip install "mlflow[databricks]>=2.15.0" "databricks-sdk>=0.30.0"
```

### 1.2 Get Model Info from Endpoint

If you have a serving endpoint name, extract the model details:

```bash
# Get endpoint info (remember to include --profile if using non-default)
databricks serving-endpoints get <endpoint-name> --profile <profile> --output json
```

Look for `served_entities[0].entity_name` (model name) and `entity_version` in the response. Find the entity with 100% traffic in `traffic_config.routes`.

### 1.3 Download Model Artifacts

Use MLflow Python to download the artifacts:

```bash
python3 << 'EOF'
import mlflow
import os

# Set profile for authentication (change if using non-default profile)
os.environ["DATABRICKS_CONFIG_PROFILE"] = "<selected-profile>"

# Configure MLflow for Databricks
mlflow.set_tracking_uri("databricks")

# Replace with actual values from step 1.2
MODEL_NAME = "<model-name>"
VERSION = "<version>"

print(f"Downloading model: models:/{MODEL_NAME}/{VERSION}")
mlflow.artifacts.download_artifacts(
    artifact_uri=f"models:/{MODEL_NAME}/{VERSION}",
    dst_path="./original_mlflow_model"
)
print("Download complete! Artifacts saved to ./original_mlflow_model")
EOF
```

### 1.4 Verify Downloaded Artifacts

Check that the key files exist:

```bash
# List downloaded files
ls -la ./original_mlflow_model/

# The agent code is typically in one of these locations:
ls ./original_mlflow_model/code/agent.py 2>/dev/null || ls ./original_mlflow_model/agent.py 2>/dev/null

# Check for MLmodel file (contains resource requirements)
cat ./original_mlflow_model/MLmodel

# Check for input example (useful for testing)
cat ./original_mlflow_model/input_example.json 2>/dev/null
```

### 1.5 Deactivate Virtual Environment

After downloading, deactivate the migration environment:

```bash
deactivate
```

### Expected Output Structure

After successful download, you should have:

```
./original_mlflow_model/
├── MLmodel              # Model metadata and resource requirements
├── code/
│   └── agent.py         # Main agent implementation
├── input_example.json   # Sample request for testing
├── requirements.txt     # Original dependencies
└── ...
```

### Key Files to Examine

1. **`agent.py`** - Contains the `ResponsesAgent` class with `predict()` and `predict_stream()` methods
2. **`MLmodel`** - Contains the `resources` section listing required Databricks resources
3. **`input_example.json`** - Use this to test the migrated agent

### Troubleshooting Model Download

**"ModuleNotFoundError: No module named 'mlflow'"**
Ensure you've activated the virtual environment and installed requirements:
```bash
source .migration-venv/bin/activate
pip install "mlflow[databricks]>=2.15.0" "databricks-sdk>=0.30.0"
```

**"Unable to import necessary dependencies to access model version files in Unity Catalog"**
This means boto3 is missing. The `mlflow[databricks]` extra includes boto3, but if you installed manually:
```bash
pip install boto3
```

**"INVALID_PARAMETER_VALUE" or authentication errors**
Re-authenticate with Databricks (include profile if non-default):
```bash
databricks auth login --profile <profile>
```

**Wrong workspace / Model not found**
Make sure you're using the correct profile that corresponds to the workspace where the model is deployed:
```bash
# List profiles to see which workspace each points to
databricks auth profiles

# Verify you can access the workspace
databricks current-user me --profile <profile>

# List models in that workspace
databricks registered-models list --profile <profile>
databricks model-versions list --name "<model-name>" --profile <profile>
```

---

## Step 2: Understand the Key Transformations

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

## Step 3: Migrate the Agent Code

### 3.1 Copy Your Configuration

From the original agent, extract and preserve:
- **LLM endpoint name** (e.g., `databricks-claude-sonnet-4-5`)
- **System prompt**
- **Tool definitions**
- **Any custom logic**

### 3.2 Create the App Structure

Edit `migrated_app/agent_server/agent.py`:

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

### 3.3 Handle Stateful Agents

**If original uses checkpointer (short-term memory):**
- Add `AsyncCheckpointSaver` with Lakebase integration
- Configure `LAKEBASE_INSTANCE_NAME` in `.env`
- Extract thread_id from `request.custom_inputs` or `request.context.conversation_id`

**If original uses store (long-term memory):**
- Add `AsyncDatabricksStore` with Lakebase integration
- Configure `LAKEBASE_INSTANCE_NAME` in `.env`
- Extract user_id from `request.custom_inputs` or `request.context.user_id`

---

## Step 4: Set Up the App

### 4.1 Verify Build Configuration

Before installing dependencies, ensure the `pyproject.toml` has the correct hatchling configuration to find packages, and that a README file exists (hatchling requires this).

**Check that `pyproject.toml` includes the hatch build configuration:**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["agent_server", "scripts"]
```

If the `[tool.hatch.build.targets.wheel]` section is missing, add it with the appropriate package directories.

**Ensure a README file exists:**

```bash
# Create a minimal README if one doesn't exist
if [ ! -f "README.md" ]; then
  echo "# Migrated Agent App" > README.md
fi
```

### 4.2 Install Dependencies

```bash
cd migrated_app
uv sync
```

### 4.3 Create requirements.txt for Databricks Apps

Databricks Apps requires a `requirements.txt` file with `uv` to install dependencies from `pyproject.toml`:

```bash
echo "uv" > requirements.txt
```

### 4.4 Run Quickstart

Run the `uv run quickstart` script to quickly set up your local environment. This is the **recommended** way to configure the app as it handles all necessary setup automatically.

```bash
uv run quickstart
```

This script will:

1. Verify uv, nvm, and Databricks CLI installations
2. Configure Databricks authentication
3. Configure agent tracing, by creating and linking an MLflow experiment to your app
4. Configure `.env` with the necessary environment variables

> **Important:** The quickstart script creates the MLflow experiment that the app needs for logging traces and models. This experiment will be added as a resource when deploying the app.

If there are issues with the quickstart script, refer to the manual setup in section 4.5.

### 4.5 Manual Environment Configuration (Optional)

If you need to manually configure the environment or add additional variables, edit `.env`:

```bash
# Databricks authentication
DATABRICKS_CONFIG_PROFILE=<your-profile>

# MLflow experiment (created by quickstart, or create manually)
MLFLOW_EXPERIMENT_ID=<experiment-id>

# Example: Lakebase for stateful agents
LAKEBASE_INSTANCE_NAME=<your-lakebase-instance>

# Example: Custom API keys
MY_API_KEY=<value>
```

To manually create an MLflow experiment:

```bash
databricks experiments create-experiment "/Users/<your-username>/<app-name>" --profile <profile>
```

---

## Step 5: Test Locally

> Test your migrated agent locally before deploying to Databricks Apps. This helps catch configuration issues early and ensures the agent works correctly.

### 5.1 Start the Server

After the quickstart setup is complete, start the agent server and chat app locally:

```bash
cd migrated_app
uv run start-app
```

Wait for the server to start. You should see output indicating the server is running on `http://localhost:8000`.

> **Note:** If you only need the API endpoint (without the chat UI), you can run `uv run start-server` instead.

### 5.2 Test with Original Input Example

The original model artifacts include an `input_example.json` file that contains a sample request. Use this to verify your migrated agent produces the same behavior. If there's no valid sample request then figure out a valid sample request to query agent based on its code.

```bash
# Check the original input example (from the migrated_app directory)
cat ../original_mlflow_model/input_example.json
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
  -d "$(cat ../original_mlflow_model/input_example.json)"
```

### 5.3 Test Basic Requests

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

### 5.4 Test with Custom Inputs (for stateful agents)

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

### 5.5 Verify Before Proceeding

Before proceeding to deployment, ensure:
- [ ] The server starts without errors
- [ ] The original input example returns a valid response
- [ ] Streaming responses work correctly
- [ ] Custom inputs (thread_id, user_id) are handled properly (if applicable)

> **Note:** Only proceed to Step 6 (Deploy) after confirming the agent works correctly locally.

---

## Step 6: Deploy to Databricks Apps

### 6.1 Extract Resources from Original Model

The original model's `MLmodel` file contains a `resources` section that lists all Databricks resources the agent needs access to. Check `../original_mlflow_model/MLmodel` (or `./original_mlflow_model/MLmodel` if you're in the parent directory) for content like:

```yaml
resources:
  api_version: '1'
  databricks:
    lakebase:
    - name: lakebase
    serving_endpoint:
    - name: databricks-claude-sonnet-4-5
```

### 6.2 Create the App with Resources

**First, ask the user what they want to name their new app.**

> "What would you like to name your new Databricks App? (App names must be lowercase, can contain letters, numbers, and hyphens, and must be unique within your workspace)"

Use the name provided by the user in the `databricks apps create` command below.

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
| *(required)* | `experiment` | `experiment_id`, `permission` (CAN_MANAGE, CAN_EDIT, CAN_READ) |

> **Important:** The `experiment` resource is **required** for all Databricks Apps agents. The quickstart script creates this experiment and stores the ID in `.env`. You must include this experiment as a resource when creating the app.

**Important:** When using `--json`, do NOT include the app name as a positional argument—put it inside the JSON only.

**Example with serving endpoint and UC function (e.g., python_exec):**

```bash
# Get the experiment ID from .env (created by quickstart)
EXPERIMENT_ID=$(grep MLFLOW_EXPERIMENT_ID .env | cut -d'=' -f2)

# Correct: app name is ONLY in the JSON when you pass resources in
# Replace <app-name> with the name provided by the user
databricks apps create --json '{
  "name": "<app-name>",
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
    },
    {
      "name": "experiment",
      "experiment": {
        "experiment_id": "'$EXPERIMENT_ID'",
        "permission": "CAN_MANAGE"
      }
    }
  ]
}'
```

**Example with Lakebase (for stateful agents):**

```bash
# Replace <app-name> with the name provided by the user
databricks apps create --json '{
  "name": "<app-name>",
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

### 6.3 Sync Files

**IMPORTANT:** Run the sync command from INSIDE the `migrated_app` directory, using `.` as the source.

```bash
# Get your username
DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)

# Change into the migrated_app directory
cd migrated_app

# Sync current directory (.) to workspace
databricks sync . "/Users/$DATABRICKS_USERNAME/migrated_app"
```

### 6.4 Deploy

```bash
databricks apps deploy <app-name> --source-code-path /Workspace/Users/$DATABRICKS_USERNAME/migrated_app
```

### 6.5 Test Deployed App

```bash
# Get OAuth token
TOKEN=$(databricks auth token | jq -r .access_token)

# Query the app
curl -X POST <app-url>/invocations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hello!"}]}'
```

### 6.6 Deployment Troubleshooting

If you encounter issues during deployment, refer to the **deploy** skill for detailed guidance

**Debug commands:**
```bash
# View app logs
databricks apps logs <app-name> --follow

# Check app status
databricks apps get <app-name> --output json | jq '{app_status, compute_status}'

# Get app URL
databricks apps get <app-name> --output json | jq -r '.url'
```

---

## Reference: App File Structure

```
migrated_app/
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
