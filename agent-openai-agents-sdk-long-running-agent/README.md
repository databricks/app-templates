# Long-Running Responses API Agent

This template extends [agent-openai-agents-sdk](https://github.com/databricks/app-templates/tree/main/agent-openai-agents-sdk) with support for long-running agent queries. It adds background execution, database persistence, and stream resumption — enabling use cases where agent responses take minutes rather than seconds.

Standard synchronous invoke/stream behavior is fully preserved when `background=false` (default), so this template is backward-compatible with the base.

## New Features (vs agent-openai-agents-sdk)

### 1. Background Execution Mode

The base template blocks the HTTP connection until the agent finishes. This template adds a `background=true` flag that returns a `response_id` immediately and runs the agent asynchronously. Clients poll or stream results via a separate GET endpoint.

This solves the core problem: Databricks Apps enforces a ~120s connection timeout, which kills long-running agent responses. Background mode decouples the agent's execution lifetime from the HTTP connection.

### 2. Lakebase Persistence Layer

All stream events are persisted to PostgreSQL (Lakebase) with two tables:

| Table       | Schema         | Purpose                                                                                             |
| ----------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `responses` | `agent_server` | Tracks response ID, status (`in_progress`/`completed`/`failed`), creation time, and MLflow trace ID |
| `messages`  | `agent_server` | Stores each stream event with a `sequence_number` for ordered retrieval                             |

This enables:

- **Connection resilience**: clients can disconnect and reconnect without losing progress
- **Cursor-based resumption**: `starting_after=N` skips already-received events on reconnect
- **Polling**: completed responses return full output from the database

When `LAKEBASE_INSTANCE_NAME` is not set, the server runs without background mode — standard invoke/stream still work identically to the base template.

### 3. LongRunningAgentServer

A custom `LongRunningAgentServer` class extends MLflow's `AgentServer` with:

- **New endpoint**: `GET /responses/{id}` for polling and streaming from the database
- **Background task management**: spawns agent work via `asyncio.create_task()`, decoupled from the request lifecycle
- **Three-layer timeout protection**:
  1. `asyncio.timeout(TASK_TIMEOUT_SECONDS)` — hard limit (default 30 min)
  2. Deferred error marking — async cleanup if task is cancelled
  3. Stale-run detection — catches zombie tasks that exceed the timeout

### 4. Configurable Timeouts

| Variable                  | Default       | Purpose                                   |
| ------------------------- | ------------- | ----------------------------------------- |
| `TASK_TIMEOUT_SECONDS`    | 1800 (30 min) | Max duration for a background task        |
| `POLL_INTERVAL_SECONDS`   | 1.0           | Server-side polling delay in GET requests |
| `DB_STATEMENT_TIMEOUT_MS` | 5000          | Postgres query timeout                    |

### Summary Table

| Aspect               | Base Template                     | This Template                         |
| -------------------- | --------------------------------- | ------------------------------------- |
| Request handling     | Blocking POST only                | Blocking POST + async background POST |
| Long-running support | No (timeout after ~120s on Apps)  | Yes (30 min default, configurable)    |
| Persistence          | None                              | Lakebase PostgreSQL                   |
| Stream resumption    | Not possible                      | Cursor-based via `starting_after=N`   |
| Server class         | MLflow `AgentServer`              | `LongRunningAgentServer` (extends it) |
| Deployment           | `databricks sync` + `apps deploy` | Databricks Asset Bundles              |
| Retrieve endpoint    | N/A                               | `GET /responses/{id}`                 |

---

## Client Contract

This section defines how to call the agent via the OpenAI SDK and the corresponding raw REST requests. Replace `<base_url>` with `http://localhost:8000` (local) or `https://<app-name>.databricksapps.com` (deployed, with `Authorization: Bearer <oauth_token>` header).

All examples use the `POST /responses` endpoint. `/invocations` is an alias that behaves identically.

---

### 1. Standard Invocations (no background mode)

Identical to the base `agent-openai-agents-sdk` template. The POST blocks until the agent finishes.

#### Non-streaming (invoke)

**OpenAI SDK:**

```python
resp = client.responses.create(
    input=[{"role": "user", "content": "hi"}],
    model="agent",
)
print(resp.output)
```

**curl:**

```bash
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

Response: `{"output": [...]}`

#### Streaming

**OpenAI SDK:**

```python
stream = client.responses.create(
    input=[{"role": "user", "content": "hi"}],
    model="agent",
    stream=True,
)
for event in stream:
    process(event)
```

**curl:**

```bash
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
```

Response: SSE stream ending with `[DONE]`.

---

### 2. Background Mode

Background mode (`background=true`) returns a `response_id` immediately and runs the agent asynchronously. The client uses the retrieve endpoint (`GET /responses/{id}`) to get results. Background mode requires a configured Lakebase database.

#### 2a. Kick off without stream + poll

The simplest background pattern. POST returns immediately with an ID; client polls GET until a terminal status.

**OpenAI SDK:**

```python
# Kick off
resp = client.responses.create(
    input=[{"role": "user", "content": "..."}],
    model="agent",
    background=True,
)

# Poll
while resp.status in ("queued", "in_progress"):
    time.sleep(2)
    resp = client.responses.retrieve(resp.id)

print(resp.output)  # available when status == "completed"
```

**curl:**

```bash
# Kick off
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "..." }], "background": true }'
# Returns: { "id": "resp_xxx", "status": "in_progress", ... }

# Poll (repeat until status is "completed" or "failed")
curl <base_url>/responses/resp_xxx
# Returns: { "id": "resp_xxx", "status": "in_progress" }
# ... eventually:
# Returns: { "id": "resp_xxx", "status": "completed", "output": [...] }
```

#### 2b. Kick off with stream + retrieve with stream (resumable streaming)

POST streams events on the initial connection. If the connection drops (e.g. Databricks Apps ~120s timeout), resume via GET with `stream=true` and `starting_after=<last_sequence_number>` to pick up where you left off.

Every SSE event includes a `sequence_number` (integer, monotonically increasing). Track this value — it's the cursor for resumption.

**OpenAI SDK:**

```python
# Kick off — stream from the POST connection
stream = client.responses.create(
    input=[{"role": "user", "content": "..."}],
    model="agent",
    stream=True,
    background=True,
)
response_id = None
last_seq = 0

for event in stream:
    if hasattr(event, "response"):
        response_id = event.response.id
    if hasattr(event, "sequence_number"):
        last_seq = event.sequence_number
    process(event)

# If connection dropped before [DONE], resume with stream
stream = client.responses.retrieve(
    response_id,
    stream=True,
    starting_after=last_seq,
)
for event in stream:
    process(event)
```

**curl:**

```bash
# Kick off with stream
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "..." }], "stream": true, "background": true }'
# Returns: SSE stream with sequence_number on each event

# Resume from where you left off (e.g. last_seq was 5)
curl "<base_url>/responses/resp_xxx?stream=true&starting_after=5"
# Returns: SSE stream with events from sequence_number 6 onward
```

**SSE event format:**

```
event: response.created
data: {"type":"response.created","response":{"id":"resp_xxx","status":"in_progress",...},"sequence_number":0}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"Hello","sequence_number":1}

event: response.output_item.done
data: {"type":"response.output_item.done","item":{...},"sequence_number":2}

data: [DONE]
```

Omitting `starting_after` on the GET replays all events from the beginning (no deduplication).

#### 2c. Kick off with stream + retrieve with poll (stream then collect)

POST streams events on the initial connection. If the connection drops, instead of resuming the stream, poll GET without `stream=true` to get the final completed response as JSON.

**OpenAI SDK:**

```python
# Kick off — stream from the POST connection
stream = client.responses.create(
    input=[{"role": "user", "content": "..."}],
    model="agent",
    stream=True,
    background=True,
)
response_id = None

for event in stream:
    if hasattr(event, "response"):
        response_id = event.response.id
    process(event)

# If connection dropped before [DONE], poll for the final result
resp = client.responses.retrieve(response_id)
while resp.status in ("queued", "in_progress"):
    time.sleep(2)
    resp = client.responses.retrieve(response_id)

print(resp.output)
```

**curl:**

```bash
# Kick off with stream
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "..." }], "stream": true, "background": true }'
# Returns: SSE stream (may drop before [DONE])

# Poll for final result (no stream=true)
curl <base_url>/responses/resp_xxx
# Returns: { "id": "resp_xxx", "status": "completed", "output": [...] }
```

---

### Retrieve Endpoint Reference

`GET /responses/{response_id}`

| Param            | Type    | Default | Description                                                                    |
| ---------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `stream`         | boolean | `false` | `true` returns SSE stream; `false` returns JSON                                |
| `starting_after` | integer | `0`     | Resume SSE stream after this sequence number (only applies when `stream=true`) |

### Status Values

| Status        | Meaning                                   |
| ------------- | ----------------------------------------- |
| `in_progress` | Agent is still running                    |
| `completed`   | Agent finished; `output` contains results |
| `failed`      | Agent errored; no output                  |

Terminal statuses: `completed`, `failed`. Stop polling/streaming when you see either.

### Error Events (SSE)

```
event: error
data: {"error":{"message":"Response not found","type":"not_found","code":"response_not_found"}}
```

### Summary

| Mode                                    | POST body                                   | POST response         | Retrieve                                           |
| --------------------------------------- | ------------------------------------------- | --------------------- | -------------------------------------------------- |
| Invoke                                  | `{ input }`                                 | JSON `{ output }`     | Not needed                                         |
| Stream                                  | `{ input, stream: true }`                   | SSE stream            | Not needed                                         |
| 2a: Background + poll                   | `{ input, background: true }`               | JSON `{ id, status }` | `GET /responses/{id}` until terminal               |
| 2b: Background + stream + stream resume | `{ input, stream: true, background: true }` | SSE stream            | `GET /responses/{id}?stream=true&starting_after=N` |
| 2c: Background + stream + poll resume   | `{ input, stream: true, background: true }` | SSE stream            | `GET /responses/{id}` until terminal               |

---

## Quick Start

```bash
uv run quickstart    # first-time setup
uv run start-app     # start agent server + chat UI
```

## Testing

See `scripts/test_long_running_agent.py` for a Pytest suite that exercises all client modes (sync, stream, background + poll, background + stream with cursor resumption).

## Key Files

| File                                  | Purpose                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| `agent_server/agent.py`               | Agent logic, model, instructions, MCP servers                        |
| `agent_server/long_running_server.py` | `LongRunningAgentServer` with background mode and retrieve endpoints |
| `agent_server/start_server.py`        | FastAPI server, DB lifecycle hooks, MLflow setup                     |
| `agent_server/db/`                    | SQLAlchemy models, repository, Lakebase connection                   |
| `agent_server/settings.py`            | Typed configuration (`TASK_TIMEOUT_SECONDS`, etc.)                   |
| `databricks.yml`                      | Bundle config with Lakebase + MLflow + app resources                 |
| `scripts/test_long_running_agent.py`  | Pytest suite covering all client modes                               |

## References

- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [OpenAI Background Streaming Guide](https://developers.openai.com/api/docs/guides/background/#streaming-a-background-response)
- [MLflow ResponsesAgent Docs](https://mlflow.org/docs/latest/genai/flavors/responses-agent-intro/)
- [Databricks Apps Documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)
