---
name: agent-memory
description: "Understand and modify agent memory patterns. Use when: (1) User asks about 'memory', 'state', 'conversation history', (2) Working with thread_id or user_id, (3) Debugging memory issues, (4) Adding long-term memory capabilities."
---

# Agent Memory Patterns

This skill covers both short-term memory (conversation history within a session) and long-term memory (facts that persist across sessions).

## Short-Term Memory (This Template)

Short-term memory stores conversation history within a thread. The agent remembers what was said earlier in the conversation.

### Key Components

**AsyncCheckpointSaver** - Persists LangGraph state to Lakebase:

```python
from databricks_langchain import AsyncCheckpointSaver

async with AsyncCheckpointSaver(instance_name=LAKEBASE_INSTANCE_NAME) as checkpointer:
    agent = await init_agent(checkpointer=checkpointer)
    # Agent now persists state between calls
```

**StatefulAgentState** - Custom state schema for memory:

```python
from typing import Any, Sequence, TypedDict
from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from typing_extensions import Annotated

class StatefulAgentState(TypedDict, total=False):
    messages: Annotated[Sequence[AnyMessage], add_messages]
    custom_inputs: dict[str, Any]
    custom_outputs: dict[str, Any]
```

**Thread ID** - Identifies a conversation thread:

```python
def _get_or_create_thread_id(request: ResponsesAgentRequest) -> str:
    # Priority:
    # 1. Use thread_id from custom_inputs
    # 2. Use conversation_id from ChatContext
    # 3. Generate random UUID
    ci = dict(request.custom_inputs or {})

    if "thread_id" in ci and ci["thread_id"]:
        return str(ci["thread_id"])

    if request.context and getattr(request.context, "conversation_id", None):
        return str(request.context.conversation_id)

    return str(uuid_utils.uuid7())
```

### Creating a Stateful Agent

Pass `checkpointer` and `state_schema` to `create_agent()`:

```python
from langchain.agents import create_agent

agent = create_agent(
    model=model,
    tools=tools,
    system_prompt=SYSTEM_PROMPT,
    checkpointer=checkpointer,      # Enables persistence
    state_schema=StatefulAgentState, # Custom state with messages
)
```

### Using Thread ID in Requests

The agent uses `config` to track threads:

```python
config = {"configurable": {"thread_id": thread_id}}
input_state = {
    "messages": to_chat_completions_input([i.model_dump() for i in request.input]),
    "custom_inputs": dict(request.custom_inputs or {}),
}

async for event in agent.astream(input_state, config, stream_mode=["updates", "messages"]):
    # Process events
```

---

## API Requests with Memory

### Continuing a Conversation (with thread_id)

```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What did we discuss?"}],
      "custom_inputs": {"thread_id": "<existing-thread-id>"}
  }'
```

### Starting a New Conversation

Omit `thread_id` to start fresh (a new UUID will be generated):

```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hello!"}], "stream": true}'
```

The response includes `thread_id` in `custom_outputs` - save it to continue the conversation.

### Deployed App with Memory

```bash
curl -X POST <app-url>/invocations \
  -H "Authorization: Bearer <oauth-token>" \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "Remember this: my favorite color is blue"}],
      "custom_inputs": {"thread_id": "user-123-session-1"}
  }'
```

---

## Long-Term Memory (Reference)

Long-term memory stores facts that persist across conversation sessions (e.g., user preferences). This is available in the `agent-langgraph-long-term-memory` template.

### Key Components (Long-Term)

**AsyncDatabricksStore** - Persists memories to Lakebase:

```python
from databricks_langchain import AsyncDatabricksStore

async with AsyncDatabricksStore(instance_name=LAKEBASE_INSTANCE_NAME) as store:
    # Store persists memories across sessions
```

**User ID** - Identifies a user across sessions:

```python
user_id = request.custom_inputs.get("user_id", "default-user")
```

**Memory Tools** - LangGraph provides tools for memory management:
- `manage_memory` - Save/update memories about the user
- The agent can reference stored memories in conversations

### Long-Term Memory Request Example

```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What do you remember about me?"}],
      "custom_inputs": {
          "thread_id": "<thread-id>",
          "user_id": "user-123"
      }
  }'
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Conversation not persisting** | Verify `thread_id` is passed and consistent |
| **"Cannot connect to Lakebase"** | See **lakebase-setup** skill |
| **Permission errors** | Grant checkpoint table permissions (see **lakebase-setup** skill) |
| **State not loading** | Check that `checkpointer` is passed to `create_agent()` |

## Dependencies

Short-term memory requires `databricks-langchain[memory]`:

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
