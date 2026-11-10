---
name: agent-openai-memory
description: "Add memory capabilities to your agent. Use when: (1) User asks about 'memory', 'state', 'remember', 'conversation history', (2) Want to persist conversations or user preferences, (3) Adding checkpointing or long-term storage."
---

# Stateful Memory with OpenAI Agents SDK Sessions

This template uses OpenAI Agents SDK [Sessions](https://openai.github.io/openai-agents-python/sessions/) with `AsyncDatabricksSession` to persist conversation history to a Databricks Lakebase instance.

## How Sessions Work

Sessions automatically manage conversation history for multi-turn interactions:

1. **Before each run**: The session retrieves prior conversation history and prepends it to input
2. **During the run**: New items (user messages, responses, tool calls) are generated
3. **After each run**: All new items are automatically stored in the session

This eliminates the need to manually manage conversation state between runs.

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Session** | Stores conversation history for a specific `session_id` |
| **`session_id`** | Unique identifier linking requests to the same conversation |
| **`AsyncDatabricksSession`** | Session implementation backed by Databricks Lakebase |
| **`LAKEBASE_AUTOSCALING_ENDPOINT`** | Environment variable specifying the autoscaling Lakebase endpoint |

## How This Template Uses Sessions

### Session Creation (`agent_server/agent.py`)

```python
from databricks_openai.agents import AsyncDatabricksSession

session = AsyncDatabricksSession(
    session_id=get_session_id(request),
    autoscaling_endpoint=lakebase_config.autoscaling_endpoint,
    project=lakebase_config.autoscaling_project,
    branch=lakebase_config.autoscaling_branch,
)

result = await Runner.run(agent, messages, session=session)
```

### Session ID Extraction (`agent_server/agent.py`)

The `session_id` is extracted from `custom_inputs` or auto-generated:

```python
def get_session_id(request: ResponsesAgentRequest) -> str:
    if hasattr(request, "custom_inputs") and request.custom_inputs:
        if "session_id" in request.custom_inputs:
            return request.custom_inputs["session_id"]
    return str(uuid7())
```

### Lakebase Config (`agent_server/utils.py`)

The autoscaling Lakebase config is read from env vars into a `LakebaseConfig` by `init_lakebase_config()` (priority: endpoint > project+branch):

```python
lakebase_config = init_lakebase_config()  # reads LAKEBASE_AUTOSCALING_ENDPOINT / PROJECT / BRANCH
```

---

## Prerequisites

1. **Dependency**: `databricks-openai[memory]` must be in `pyproject.toml` (already included)

2. **Lakebase instance**: You need an autoscaling Databricks Lakebase instance. See the **lakebase-setup** skill for creating and configuring one.

3. **Environment variable**: Set `LAKEBASE_AUTOSCALING_ENDPOINT` in your `.env` file:
   ```bash
   LAKEBASE_AUTOSCALING_ENDPOINT=<your-endpoint>
   ```

---

## Configuration Files

### databricks.yml (Lakebase Resource)

Add the autoscaling `postgres` resource to your app:

```yaml
resources:
  apps:
    agent_openai_advanced:
      name: "your-app-name"
      source_code_path: ./

      resources:
        # ... other resources (experiment, etc.) ...

        # Autoscaling Lakebase instance for session storage
        - name: 'postgres'
          postgres:
            branch: "projects/<project-name>/branches/<branch-name>"
            database: "projects/<project-name>/branches/<branch-name>/databases/<database-id>"
            permission: 'CAN_CONNECT_AND_CREATE'
```

### databricks.yml config block (Environment Variables)

The `LAKEBASE_AUTOSCALING_ENDPOINT` env var is resolved from the postgres resource at deploy time. Add to your app's `config.env` in `databricks.yml`:

```yaml
      config:
        env:
          - name: LAKEBASE_AUTOSCALING_ENDPOINT
            value_from: "postgres"
```

### .env (Local Development)

```bash
LAKEBASE_AUTOSCALING_ENDPOINT=<your-endpoint>
```

---

## Testing Sessions

### Test Multi-Turn Conversation Locally

```bash
# Start the server
uv run start-app

# First message - starts a new session
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hello, I live in SF!"}]}'

# Note the session_id from custom_outputs in the response

# Second message - continues the same session
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What city did I say I live in?"}],
      "custom_inputs": {"session_id": "<session_id from previous response>"}
  }'
```

### Test Streaming

```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "Hello!"}],
      "stream": true
  }'
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| **"Lakebase configuration is required"** | Missing env var | Set `LAKEBASE_AUTOSCALING_ENDPOINT` in `.env` |
| **SSL connection closed unexpectedly** | Network/instance issue | Verify the Lakebase endpoint is reachable via the postgres API |
| **Agent doesn't remember previous messages** | Different session_id | Pass the same `session_id` via `custom_inputs` across requests |
| **Permission denied** | Missing Lakebase access | Add `postgres` resource to `databricks.yml` with `CAN_CONNECT_AND_CREATE` |

---

## Next Steps

- Configure Lakebase: see **lakebase-setup** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
