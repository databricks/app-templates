---
name: agent-memory
description: "Understand and modify agent memory patterns. Use when: (1) User asks about 'memory', 'state', 'user preferences', (2) Working with user_id or memory tools, (3) Debugging memory issues, (4) Adding short-term memory capabilities."
---

# Agent Memory Patterns

This skill covers both long-term memory (facts that persist across sessions) and short-term memory (conversation history within a session).

## Long-Term Memory (This Template)

Long-term memory stores facts about users that persist across conversation sessions. The agent can remember preferences, facts, and information across multiple interactions.

### Key Components

**AsyncDatabricksStore** - Persists user memories to Lakebase with semantic search:

```python
from databricks_langchain import AsyncDatabricksStore

async with AsyncDatabricksStore(
    instance_name=LAKEBASE_INSTANCE_NAME,
    embedding_endpoint=EMBEDDING_ENDPOINT,
    embedding_dims=EMBEDDING_DIMS,
) as store:
    agent = await init_agent(store=store)
    # Agent now has access to persistent memory store
```

**User ID** - Identifies a user across sessions:

```python
def _get_user_id(request: ResponsesAgentRequest) -> Optional[str]:
    custom_inputs = dict(request.custom_inputs or {})
    if "user_id" in custom_inputs:
        return custom_inputs["user_id"]
    if request.context and getattr(request.context, "user_id", None):
        return request.context.user_id
    return None
```

### Memory Tools

The template includes three memory tools that the agent can use:

**get_user_memory** - Search for relevant information about the user:

```python
@tool
async def get_user_memory(query: str, config: RunnableConfig) -> str:
    """Search for relevant information about the user from long-term memory."""
    user_id = config.get("configurable", {}).get("user_id")
    store = config.get("configurable", {}).get("store")

    namespace = ("user_memories", user_id.replace(".", "-"))
    results = await store.asearch(namespace, query=query, limit=5)
    # Returns formatted memory items
```

**save_user_memory** - Save information about the user:

```python
@tool
async def save_user_memory(memory_key: str, memory_data_json: str, config: RunnableConfig) -> str:
    """Save information about the user to long-term memory."""
    # memory_data_json must be a valid JSON object string
    await store.aput(namespace, memory_key, memory_data)
```

**delete_user_memory** - Remove specific memories:

```python
@tool
async def delete_user_memory(memory_key: str, config: RunnableConfig) -> str:
    """Delete a specific memory from the user's long-term memory."""
    await store.adelete(namespace, memory_key)
```

### Creating a Long-Term Memory Agent

Pass `store` to `create_agent()`:

```python
from langchain.agents import create_agent

agent = create_agent(
    model=ChatDatabricks(endpoint=LLM_ENDPOINT_NAME),
    tools=mcp_tools + init_memory_tools(),  # Include memory tools
    system_prompt=SYSTEM_PROMPT,
    store=store,  # Enables long-term memory
)
```

### System Prompt for Memory

The template includes instructions for using memory tools:

```python
SYSTEM_PROMPT = """You are a helpful assistant.

You have access to memory tools that allow you to remember information about users:
- Use get_user_memory to search for previously saved information about the user
- Use save_user_memory to remember important facts, preferences, or details the user shares
- Use delete_user_memory to forget specific information when asked

Always check for relevant memories at the start of a conversation to provide personalized responses."""
```

---

## API Requests with Long-Term Memory

### Request with user_id

```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "My favorite color is blue, remember that"}],
      "custom_inputs": {"user_id": "user@example.com"}
  }'
```

### Query stored memories

```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What do you remember about me?"}],
      "custom_inputs": {"user_id": "user@example.com"}
  }'
```

### Using context instead of custom_inputs

```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What is my favorite color?"}],
      "context": {"user_id": "user@example.com"}
  }'
```

### Deployed App with Memory

```bash
curl -X POST <app-url>/invocations \
  -H "Authorization: Bearer <oauth-token>" \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What do you remember about me?"}],
      "custom_inputs": {"user_id": "user@example.com"}
  }'
```

---

## Short-Term Memory (Reference)

Short-term memory stores conversation history within a thread. This is available in the `agent-langgraph-short-term-memory` template.

### Key Components (Short-Term)

**AsyncCheckpointSaver** - Persists LangGraph state to Lakebase:

```python
from databricks_langchain import AsyncCheckpointSaver

async with AsyncCheckpointSaver(instance_name=LAKEBASE_INSTANCE_NAME) as checkpointer:
    agent = await init_agent(checkpointer=checkpointer)
```

**Thread ID** - Identifies a conversation thread:

```python
thread_id = request.custom_inputs.get("thread_id") or str(uuid_utils.uuid7())
config = {"configurable": {"thread_id": thread_id}}
```

### Short-Term Memory Request Example

```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What did we discuss earlier?"}],
      "custom_inputs": {"thread_id": "<thread-id>"}
  }'
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Memories not persisting** | Verify `user_id` is passed consistently |
| **"Cannot connect to Lakebase"** | See **lakebase-setup** skill |
| **Permission errors** | Grant store table permissions (see **lakebase-setup** skill) |
| **Memory not available warning** | Ensure `user_id` is provided in request |
| **No memories found** | User hasn't saved any memories yet |

## Dependencies

Long-term memory requires `databricks-langchain[memory]`:

```toml
# pyproject.toml
dependencies = [
    "databricks-langchain[memory]>=0.13.0",
]
```

## Next Steps

- Configure Lakebase: see **lakebase-setup** skill
- Modify agent behavior: see **modify-agent** skill
- Test locally: see **run-locally** skill
