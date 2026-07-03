---
name: long-running-server
description: "Upgrade to LongRunningAgentServer for background task execution surviving HTTP timeouts. Configures task queuing, status polling, and stream resumption. Use when: (1) Agent tasks may exceed HTTP timeout (~120s), (2) User wants background/async execution, (3) User says 'long running', 'background tasks', or 'async agent'."
---

# Enable Long-Running Agent Server

> **Prerequisite:** Lakebase must be configured. Follow the **lakebase-setup** skill first if not done.

Upgrades from `AgentServer` to `LongRunningAgentServer`, enabling background task execution persisted to Lakebase PostgreSQL.

| Request pattern | Description |
|---|---|
| **Standard** | `POST /responses` -- blocks until complete (queries <= 120s) |
| **Background + Poll** | `POST /responses { background: true }` then `GET /responses/{id}` |
| **Background + Stream** | `POST /responses { background: true, stream: true }` with cursor-based resumption via `starting_after` |

---

## Step 1: Add Dependency

```toml
dependencies = ["databricks-ai-bridge[agent-server]>=0.18.0"]
```

Verify: `uv sync && python -c "from databricks_ai_bridge.long_running import LongRunningAgentServer"`

---

## Step 2: Update `start_server.py`

Replace `AgentServer` with `LongRunningAgentServer`. Key changes from the base `start_server.py`:

```python
from databricks_ai_bridge.long_running import LongRunningAgentServer
from agent_server.utils import lakebase_config, replace_fake_id
# LangGraph uses: from agent_server.utils import LAKEBASE_CONFIG as lakebase_config, replace_fake_id

class AgentServer(LongRunningAgentServer):
    def transform_stream_event(self, event, response_id):
        return replace_fake_id(event, response_id)

agent_server = AgentServer(
    "ResponsesAgent",
    enable_chat_proxy=True,
    db_instance_name=lakebase_config.instance_name,
    db_autoscaling_endpoint=lakebase_config.autoscaling_endpoint,
    db_project=lakebase_config.autoscaling_project,
    db_branch=lakebase_config.autoscaling_branch,
    task_timeout_seconds=float(os.getenv("TASK_TIMEOUT_SECONDS", "3600")),
    poll_interval_seconds=float(os.getenv("POLL_INTERVAL_SECONDS", "1.0")),
)
```

Keep the existing `load_dotenv`, `setup_mlflow_git_based_version_tracking()`, and `main()` boilerplate. Add a lifespan hook to initialize Lakebase tables at startup:

```python
_original_lifespan = app.router.lifespan_context

@asynccontextmanager
async def _lifespan(app):
    try:
        async with _original_lifespan(app):
            yield
    except Exception as exc:
        logger.warning("Long-running DB init failed: %s. Background mode disabled.", exc)
        yield

app.router.lifespan_context = _lifespan
```

Verify: `uv run start-app` -- server should start without import errors.

---

## Step 3: Add `replace_fake_id` Utility

Add to `utils.py`. Only the match condition differs by SDK:

```python
# OpenAI SDK: match exact constant
try:
    from agents.models.fake_id import FAKE_RESPONSES_ID
except ImportError:
    FAKE_RESPONSES_ID = "__fake_id__"
_match = lambda s: s == FAKE_RESPONSES_ID

# LangGraph: match prefix
# _match = lambda s: s.startswith("resp_placeholder_")

def replace_fake_id(obj, real_id: str):
    if isinstance(obj, dict):
        return {k: replace_fake_id(v, real_id) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [replace_fake_id(item, real_id) for item in obj]
    elif isinstance(obj, str) and _match(obj):
        return real_id
    return obj
```

---

## Step 4: Configure Environment

Add to `databricks.yml` config env (Lakebase vars per **lakebase-setup** skill, plus):

```yaml
- name: TASK_TIMEOUT_SECONDS
  value: "3600"
- name: POLL_INTERVAL_SECONDS
  value: "1.0"
```

Add to `.env`: `TASK_TIMEOUT_SECONDS=3600` and `POLL_INTERVAL_SECONDS=1.0`

---

## Step 5: Deploy, Grant Permissions, and Verify

Follow **lakebase-setup** skill Steps 5-7 to deploy, grant SP permissions, and run the app.

**Verify background mode:**
```bash
# Submit a background task
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Hello!"}], "background": true}'

# Poll for result (use the response ID from above)
curl http://localhost:8000/responses/<response-id>
```

If polling returns the agent's response, long-running mode is working.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `ImportError: cannot import LongRunningAgentServer` | Add `databricks-ai-bridge[agent-server]>=0.18.0` and `uv sync` |
| `background=true` returns but no result | Lakebase not configured -- set env vars in `.env` / `databricks.yml` |
| Task times out | Increase `TASK_TIMEOUT_SECONDS` |
| Stream events have placeholder IDs | Ensure `AgentServer` subclass overrides `transform_stream_event` |
| DB initialization failed warning | Check Lakebase env vars and permissions (see **lakebase-setup** skill) |
