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

1. Add memory dependency to `pyproject.toml`:
   ```toml
   dependencies = [
       "databricks-langchain[memory]>=0.13.0",
   ]
   ```

2. Configure Lakebase (see **lakebase-setup** skill)

---

## Adding Short-Term Memory

Short-term memory stores conversation history within a thread. The agent remembers what was said earlier in the conversation.

### Step 1: Import and Initialize Checkpointer

```python
from databricks_langchain import AsyncCheckpointSaver

LAKEBASE_INSTANCE_NAME = os.getenv("LAKEBASE_INSTANCE_NAME")

async with AsyncCheckpointSaver(instance_name=LAKEBASE_INSTANCE_NAME) as checkpointer:
    agent = create_react_agent(
        model=model,
        tools=tools,
        checkpointer=checkpointer,  # Enables persistence
    )
```

### Step 2: Use thread_id in Requests

```python
def _get_or_create_thread_id(request: ResponsesAgentRequest) -> str:
    custom_inputs = dict(request.custom_inputs or {})
    if "thread_id" in custom_inputs and custom_inputs["thread_id"]:
        return str(custom_inputs["thread_id"])
    if request.context and getattr(request.context, "conversation_id", None):
        return str(request.context.conversation_id)
    return str(uuid.uuid4())

# Use in agent invocation
config = {"configurable": {"thread_id": thread_id}}
async for event in agent.astream(input_state, config, stream_mode=["updates", "messages"]):
    # Process events
```

### Test Short-Term Memory

```bash
# First message (starts new conversation)
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "My name is Alice"}]}'

# Continue conversation (use thread_id from response)
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What is my name?"}],
      "custom_inputs": {"thread_id": "<thread-id-from-response>"}
  }'
```

---

## Adding Long-Term Memory

Long-term memory stores facts about users that persist across conversation sessions.

### Step 1: Import and Initialize Store

```python
from databricks_langchain import AsyncDatabricksStore

LAKEBASE_INSTANCE_NAME = os.getenv("LAKEBASE_INSTANCE_NAME")
EMBEDDING_ENDPOINT = os.getenv("EMBEDDING_ENDPOINT", "databricks-gte-large-en")

async with AsyncDatabricksStore(
    instance_name=LAKEBASE_INSTANCE_NAME,
    embedding_endpoint=EMBEDDING_ENDPOINT,
) as store:
    agent = create_react_agent(
        model=model,
        tools=tools + memory_tools,  # Add memory tools
        store=store,
    )
```

### Step 2: Create Memory Tools

```python
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig

@tool
async def get_user_memory(query: str, config: RunnableConfig) -> str:
    """Search for relevant information about the user from long-term memory."""
    user_id = config.get("configurable", {}).get("user_id")
    store = config.get("configurable", {}).get("store")
    if not user_id or not store:
        return "Memory not available"

    namespace = ("user_memories", user_id.replace(".", "-"))
    results = await store.asearch(namespace, query=query, limit=5)
    if not results:
        return "No memories found"
    return "\n".join([f"- {r.value}" for r in results])

@tool
async def save_user_memory(memory_key: str, memory_data: str, config: RunnableConfig) -> str:
    """Save information about the user to long-term memory."""
    user_id = config.get("configurable", {}).get("user_id")
    store = config.get("configurable", {}).get("store")
    if not user_id or not store:
        return "Memory not available"

    namespace = ("user_memories", user_id.replace(".", "-"))
    await store.aput(namespace, memory_key, {"value": memory_data})
    return f"Saved memory: {memory_key}"
```

### Step 3: Use user_id in Requests

```python
def _get_user_id(request: ResponsesAgentRequest) -> str:
    custom_inputs = dict(request.custom_inputs or {})
    if "user_id" in custom_inputs:
        return custom_inputs["user_id"]
    if request.context and getattr(request.context, "user_id", None):
        return request.context.user_id
    return "default-user"

# Use in agent invocation
config = {"configurable": {"user_id": user_id, "store": store}}
```

### Test Long-Term Memory

```bash
# Save a preference
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "Remember that my favorite color is blue"}],
      "custom_inputs": {"user_id": "alice@example.com"}
  }'

# Recall later (even in new conversation)
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What is my favorite color?"}],
      "custom_inputs": {"user_id": "alice@example.com"}
  }'
```

---

## Using Pre-Built Memory Templates

For fully configured memory implementations, use these templates instead:

| Template | Memory Type | Key Features |
|----------|-------------|--------------|
| `agent-langgraph-short-term-memory` | Short-term | AsyncCheckpointSaver, thread_id, conversation persistence |
| `agent-langgraph-long-term-memory` | Long-term | AsyncDatabricksStore, user_id, memory tools |

These templates have memory fully integrated and tested.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **"Cannot connect to Lakebase"** | See **lakebase-setup** skill |
| **Memory not persisting** | Verify thread_id/user_id is passed consistently |
| **Permission errors** | Grant Lakebase permissions (see **lakebase-setup** skill) |
| **"Memory not available"** | Ensure user_id is provided in request |

## Next Steps

- Configure Lakebase: see **lakebase-setup** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
