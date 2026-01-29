---
name: agent-memory
description: "Add memory capabilities to your agent. Use when: (1) User asks about 'memory', 'state', 'remember', 'conversation history', (2) Want to persist conversations or user preferences, (3) Adding checkpointing or long-term storage."
---

# Adding Memory to Your Agent

> **Note:** This template does not include memory by default. Use this skill to **add memory capabilities**. For pre-configured memory templates, see:
> - `agent-langgraph-short-term-memory` - Conversation history within a session
> - `agent-langgraph-long-term-memory` - User facts that persist across sessions

## Memory Types

| Type | Use Case | Storage | Identifier |
|------|----------|---------|------------|
| **Short-term** | Conversation history within a session | `AsyncCheckpointSaver` | `thread_id` |
| **Long-term** | User facts that persist across sessions | `AsyncDatabricksStore` | `user_id` |

## Prerequisites

1. **Add memory dependency** to `pyproject.toml`:
   ```toml
   dependencies = [
       "databricks-langchain[memory]",
   ]
   ```

   Then run `uv sync`

2. **Configure Lakebase** - See **lakebase-setup** skill for:
   - Creating/configuring Lakebase instance
   - Initializing tables (CRITICAL first-time step)

---

## Quick Setup Summary

Adding memory requires changes to **4 files**:

| File | What to Add |
|------|-------------|
| `pyproject.toml` | Memory dependency + hatch config |
| `.env` | Lakebase env vars (for local dev) |
| `databricks.yml` | Lakebase database resource |
| `app.yaml` | `valueFrom` reference to lakebase resource |
| `agent_server/agent.py` | Memory tools and AsyncDatabricksStore |

---

## Step 1: Configure databricks.yml (Lakebase Resource)

Add the Lakebase database resource to your app in `databricks.yml`:

```yaml
resources:
  apps:
    agent_langgraph:
      name: "your-app-name"
      source_code_path: ./

      resources:
        # ... other resources (experiment, UC functions, etc.) ...

        # Lakebase instance for long-term memory
        - name: 'lakebadatabasese_memory'
          database:
            instance_name: '<your-lakebase-instance-name>'
            database_name: 'postgres'
            permission: 'CAN_CONNECT_AND_CREATE'
```

**Important:** The `name: 'database'` must match the `valueFrom` reference in `app.yaml`.

---

## Step 2: Configure app.yaml (Environment Variables)

Update `app.yaml` with the Lakebase environment variables:

```yaml
command: ["uv", "run", "start-app"]

env:
  # ... other env vars ...

  # MLflow experiment (uses valueFrom to reference databricks.yml resource)
  - name: MLFLOW_EXPERIMENT_ID
    valueFrom: "experiment"

  # Lakebase instance name - must match the instance_name in databricks.yml database resource
  # Note: Use 'value' (not 'valueFrom') because AsyncDatabricksStore needs the instance name,
  # not the full connection string that valueFrom would provide
  - name: LAKEBASE_INSTANCE_NAME
    value: "<your-lakebase-instance-name>"

  # Embedding configuration (static values)
  - name: EMBEDDING_ENDPOINT
    value: "databricks-gte-large-en"
  - name: EMBEDDING_DIMS
    value: "1024"
```

**Important:** The `LAKEBASE_INSTANCE_NAME` value must match the `instance_name` in your `databricks.yml` database resource. The `database` resource handles permissions, while `app.yaml` provides the instance name to your code.

### Why not valueFrom for Lakebase?

The `database` resource's `valueFrom` provides the full connection string (e.g., `instance-xxx.database.staging.cloud.databricks.com`), but `AsyncDatabricksStore` expects just the instance name. So we use a static `value` instead.

---

## Step 3: Configure .env (Local Development)

For local development, add to `.env`:

```bash
# Lakebase configuration for long-term memory
LAKEBASE_INSTANCE_NAME=<your-instance-name>
EMBEDDING_ENDPOINT=databricks-gte-large-en
EMBEDDING_DIMS=1024
```

> **Note:** `.env` is only for local development. When deployed, the app gets `LAKEBASE_INSTANCE_NAME` from the `valueFrom` reference in `app.yaml`.

---

## Step 4: Update agent.py

### Add Imports and Configuration

```python
import os
import uuid
from typing import AsyncGenerator

from databricks_langchain import AsyncDatabricksStore, ChatDatabricks
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

# Environment configuration
LAKEBASE_INSTANCE_NAME = os.getenv("LAKEBASE_INSTANCE_NAME")
EMBEDDING_ENDPOINT = os.getenv("EMBEDDING_ENDPOINT", "databricks-gte-large-en")
EMBEDDING_DIMS = int(os.getenv("EMBEDDING_DIMS", "1024"))  # REQUIRED!
```

**CRITICAL:** You MUST specify `embedding_dims` when using `embedding_endpoint`. Without it, you'll get:
```
"embedding_dims is required when embedding_endpoint is specified"
```

### Create Memory Tools

```python
@tool
async def get_user_memory(query: str, config: RunnableConfig) -> str:
    """Search for relevant information about the user from long-term memory.
    Use this to recall preferences, past interactions, or other saved information.
    """
    user_id = config.get("configurable", {}).get("user_id")
    store = config.get("configurable", {}).get("store")
    if not user_id or not store:
        return "Memory not available - no user context"

    # Sanitize user_id for namespace (replace special chars)
    namespace = ("user_memories", user_id.replace(".", "-").replace("@", "-"))
    results = await store.asearch(namespace, query=query, limit=5)
    if not results:
        return "No memories found for this query"
    return "\n".join([f"- {r.value}" for r in results])


@tool
async def save_user_memory(memory_key: str, memory_data: str, config: RunnableConfig) -> str:
    """Save information about the user to long-term memory.
    Use this to remember user preferences, important details, or other
    information that should persist across conversations.

    Args:
        memory_key: A short descriptive key (e.g., "preferred_name", "team", "region")
        memory_data: The information to save
    """
    user_id = config.get("configurable", {}).get("user_id")
    store = config.get("configurable", {}).get("store")
    if not user_id or not store:
        return "Memory not available - no user context"

    namespace = ("user_memories", user_id.replace(".", "-").replace("@", "-"))
    await store.aput(namespace, memory_key, {"value": memory_data})
    return f"Saved memory: {memory_key}"
```

### Add Helper Functions

```python
def _get_user_id(request: ResponsesAgentRequest) -> str:
    """Extract user_id from request context or custom inputs."""
    custom_inputs = dict(request.custom_inputs or {})
    if "user_id" in custom_inputs and custom_inputs["user_id"]:
        return str(custom_inputs["user_id"])
    if request.context and getattr(request.context, "user_id", None):
        return str(request.context.user_id)
    return "default-user"


def _get_or_create_thread_id(request: ResponsesAgentRequest) -> str:
    """Extract or create thread_id for conversation tracking."""
    custom_inputs = dict(request.custom_inputs or {})
    if "thread_id" in custom_inputs and custom_inputs["thread_id"]:
        return str(custom_inputs["thread_id"])
    if request.context and getattr(request.context, "conversation_id", None):
        return str(request.context.conversation_id)
    return str(uuid.uuid4())
```

### Update Streaming Function

```python
@stream()
async def streaming(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # Get user context
    user_id = _get_user_id(request)
    thread_id = _get_or_create_thread_id(request)

    # Get other tools (MCP, etc.)
    mcp_client = init_mcp_client(sp_workspace_client)
    mcp_tools = await mcp_client.get_tools()

    # Memory tools
    memory_tools = [get_user_memory, save_user_memory]

    # Combine all tools
    all_tools = mcp_tools + memory_tools

    # Initialize model
    model = ChatDatabricks(endpoint="databricks-claude-sonnet-4")

    # Use AsyncDatabricksStore for long-term memory
    async with AsyncDatabricksStore(
        instance_name=LAKEBASE_INSTANCE_NAME,
        embedding_endpoint=EMBEDDING_ENDPOINT,
        embedding_dims=EMBEDDING_DIMS,  # REQUIRED!
    ) as store:
        # Create agent with tools
        agent = create_react_agent(
            model=model,
            tools=all_tools,
            prompt=AGENT_INSTRUCTIONS,
        )

        # Prepare input
        messages = {"messages": to_chat_completions_input([i.model_dump() for i in request.input])}

        # Configure with user context for memory tools
        config = {
            "configurable": {
                "user_id": user_id,
                "thread_id": thread_id,
                "store": store,  # Pass store to tools via config
            }
        }

        # Stream agent responses
        async for event in process_agent_astream_events(
            agent.astream(input=messages, config=config, stream_mode=["updates", "messages"])
        ):
            yield event
```

---

## Step 5: Initialize Tables and Deploy

### Initialize Lakebase Tables (First Time Only)

Before deploying, initialize the tables locally:

```bash
uv run python -c "$(cat <<'EOF'
import asyncio
from databricks_langchain import AsyncDatabricksStore

async def setup():
    async with AsyncDatabricksStore(
        instance_name="<your-instance-name>",
        embedding_endpoint="databricks-gte-large-en",
        embedding_dims=1024,
    ) as store:
        await store.setup()
        print("Tables created!")

asyncio.run(setup())
EOF
)"
```

### Deploy and Run

**IMPORTANT:** Always run `databricks bundle run` after `databricks bundle deploy` to start/restart the app with the new code:

```bash
# Deploy resources and upload files
databricks bundle deploy

# Start/restart the app with new code (REQUIRED!)
databricks bundle run agent_langgraph
```

> **Note:** `bundle deploy` only uploads files and configures resources. `bundle run` is required to actually start the app with the new code.

---

## Complete Example Files

### databricks.yml (with Lakebase)

```yaml
bundle:
  name: agent_langgraph

resources:
  experiments:
    agent_langgraph_experiment:
      name: /Users/${workspace.current_user.userName}/${bundle.name}-${bundle.target}

  apps:
    agent_langgraph:
      name: "my-agent-app"
      description: "Agent with long-term memory"
      source_code_path: ./

      resources:
        - name: 'experiment'
          experiment:
            experiment_id: "${resources.experiments.agent_langgraph_experiment.id}"
            permission: 'CAN_MANAGE'

        # Lakebase instance for long-term memory
        - name: 'database'
          database:
            instance_name: '<your-lakebase-instance-name>'
            database_name: 'postgres'
            permission: 'CAN_CONNECT_AND_CREATE'

targets:
  dev:
    mode: development
    default: true
```

### app.yaml

```yaml
command: ["uv", "run", "start-app"]

env:
  - name: MLFLOW_TRACKING_URI
    value: "databricks"
  - name: MLFLOW_REGISTRY_URI
    value: "databricks-uc"
  - name: API_PROXY
    value: "http://localhost:8000/invocations"
  - name: CHAT_APP_PORT
    value: "3000"
  - name: CHAT_PROXY_TIMEOUT_SECONDS
    value: "300"
  # Reference experiment resource from databricks.yml
  - name: MLFLOW_EXPERIMENT_ID
    valueFrom: "experiment"
  # Lakebase instance name (must match instance_name in databricks.yml)
  - name: LAKEBASE_INSTANCE_NAME
    value: "<your-lakebase-instance-name>"
  # Embedding configuration
  - name: EMBEDDING_ENDPOINT
    value: "databricks-gte-large-en"
  - name: EMBEDDING_DIMS
    value: "1024"
```

---

## Adding Short-Term Memory

Short-term memory stores conversation history within a thread.

### Import and Initialize Checkpointer

```python
from databricks_langchain import AsyncCheckpointSaver

LAKEBASE_INSTANCE_NAME = os.getenv("LAKEBASE_INSTANCE_NAME")

async with AsyncCheckpointSaver(instance_name=LAKEBASE_INSTANCE_NAME) as checkpointer:
    agent = create_react_agent(
        model=model,
        tools=tools,
        checkpointer=checkpointer,  # Enables conversation persistence
    )
```

### Use thread_id in Agent Config

```python
config = {"configurable": {"thread_id": thread_id}}
async for event in agent.astream(input_state, config, stream_mode=["updates", "messages"]):
    yield event
```

---

## Testing Memory

### Test Locally

```bash
# Start the server
uv run start-app

# Save a memory
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "Remember that I am on the shipping team"}],
      "custom_inputs": {"user_id": "alice@example.com"}
  }'

# Recall the memory
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What team am I on?"}],
      "custom_inputs": {"user_id": "alice@example.com"}
  }'
```

### Test Deployed App

```bash
# Get OAuth token (PATs don't work for apps)
TOKEN=$(databricks auth token --host <workspace-url> | jq -r '.access_token')

# Test memory save
curl -X POST https://<app-url>/invocations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "Remember I prefer detailed explanations"}],
      "custom_inputs": {"user_id": "alice@example.com"}
  }'
```

---

## First-Time Setup Checklist

- [ ] Added `databricks-langchain[memory]` to `pyproject.toml`
- [ ] Run `uv sync` to install dependencies
- [ ] Created or identified Lakebase instance
- [ ] Added Lakebase env vars to `.env` (for local dev)
- [ ] Added `database` resource to `databricks.yml` (for permissions)
- [ ] Added `LAKEBASE_INSTANCE_NAME` value to `app.yaml` (matching instance_name in databricks.yml)
- [ ] **Initialized tables locally** by running `await store.setup()`
- [ ] Deployed with `databricks bundle deploy`
- [ ] **Started app with `databricks bundle run agent_langgraph`**

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| **"embedding_dims is required"** | Missing parameter | Add `embedding_dims=1024` to AsyncDatabricksStore |
| **"relation 'store' does not exist"** | Tables not created | Run `await store.setup()` locally first |
| **"Unable to resolve Lakebase instance 'None'"** | Missing env var in deployed app | Add `valueFrom: "database"` to app.yaml |
| **"permission denied for table store"** | Missing grants | Lakebase `database` resource in DAB should handle this |
| **"Memory not available"** | No user_id in request | Ensure `custom_inputs.user_id` is passed |
| **Memory not persisting** | Different user_ids | Use consistent user_id across requests |
| **App not updated after deploy** | Forgot to run bundle | Run `databricks bundle run agent_langgraph` after deploy |

---

## Pre-Built Memory Templates

For fully configured implementations without manual setup:

| Template | Memory Type | Key Features |
|----------|-------------|--------------|
| `agent-langgraph-short-term-memory` | Short-term | AsyncCheckpointSaver, thread_id |
| `agent-langgraph-long-term-memory` | Long-term | AsyncDatabricksStore, memory tools |

---

## Next Steps

- Configure Lakebase: see **lakebase-setup** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
