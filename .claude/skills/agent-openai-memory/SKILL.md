---
name: agent-openai-memory
description: "Add session-based memory to OpenAI Agents SDK agent using AsyncDatabricksSession and Lakebase. Use when: (1) User asks about 'memory', 'state', 'remember', 'conversation history', (2) Want to persist conversations or user preferences, (3) Adding session-based checkpointing."
---

# Stateful Memory with OpenAI Agents SDK Sessions

Uses `AsyncDatabricksSession` to persist conversation history to Lakebase, enabling multi-turn interactions where the agent remembers prior messages within a session.

## Prerequisites

1. **Dependency**: `databricks-openai[memory]` in `pyproject.toml` (already included in memory templates)
2. **Lakebase instance**: See **lakebase-setup** skill for creating and configuring one
3. **Environment variable**: Set `LAKEBASE_INSTANCE_NAME` in `.env`:
   ```bash
   LAKEBASE_INSTANCE_NAME=<your-lakebase-instance-name>
   ```

---

## Implementation

### Session Creation (`agent_server/agent.py`)

```python
from databricks_openai.agents import AsyncDatabricksSession

session = AsyncDatabricksSession(
    session_id=get_session_id(request),
    instance_name=LAKEBASE_INSTANCE_NAME,
)

result = await Runner.run(agent, messages, session=session)
```

### Session ID Extraction (`agent_server/agent.py`)

```python
def get_session_id(request: ResponsesAgentRequest) -> str:
    if hasattr(request, "custom_inputs") and request.custom_inputs:
        if "session_id" in request.custom_inputs:
            return request.custom_inputs["session_id"]
    return str(uuid7())
```

### Lakebase Instance Resolution (`agent_server/utils.py`)

```python
_LAKEBASE_INSTANCE_NAME_RAW = os.environ.get("LAKEBASE_INSTANCE_NAME")
LAKEBASE_INSTANCE_NAME = resolve_lakebase_instance_name(_LAKEBASE_INSTANCE_NAME_RAW)
```

---

## Configuration

### databricks.yml (Lakebase Resource)

```yaml
resources:
  - name: 'database'
    database:
      instance_name: '<your-lakebase-instance-name>'
      database_name: 'databricks_postgres'
      permission: 'CAN_CONNECT_AND_CREATE'
```

```yaml
config:
  env:
    - name: LAKEBASE_INSTANCE_NAME
      value_from: "database"
```

---

## Testing

### Verify Lakebase Connectivity

```bash
databricks lakebase instances get <instance-name> --profile <profile>
```

### Test Multi-Turn Conversation

```bash
# Start the server
uv run start-app

# First message -- starts a new session
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hello, I live in SF!"}]}'

# Note the session_id from custom_outputs in the response

# Second message -- continues the same session (should remember SF)
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What city did I say I live in?"}],
      "custom_inputs": {"session_id": "<session_id from previous response>"}
  }'
```

If the agent responds with "SF" or "San Francisco", session memory is working.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "LAKEBASE_INSTANCE_NAME environment variable is required" | Set `LAKEBASE_INSTANCE_NAME` in `.env` |
| SSL connection closed unexpectedly | Verify instance is running: `databricks lakebase instances get <name>` |
| Agent doesn't remember previous messages | Pass same `session_id` via `custom_inputs` across requests |
| "Unable to resolve hostname" | Use instance name directly instead of hostname |
| Permission denied | Add `database` resource to `databricks.yml` with `CAN_CONNECT_AND_CREATE` |

---

## Next Steps

- Configure Lakebase: see **lakebase-setup** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
