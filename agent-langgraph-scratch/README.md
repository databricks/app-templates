# Agent — LangGraph (FastAPI)

A [LangGraph](https://langchain-ai.github.io/langgraph/) agent **backend** for Databricks Apps,
served from a **from-scratch FastAPI app** — no serving framework. It runs locally with **no
database and no setup** — just an auth profile. It speaks LangGraph's **native** wire shape on both
ends: `POST /responses` / `POST /invocations` take an `input` list of LangChain message dicts
(streaming via SSE, plus an in-memory `background` mode with `GET /responses/{id}`) and return
LangChain messages — nothing is reshaped into the Responses contract.

The HTTP surface is hand-written in `server/app.py` (routes, SSE framing, tracing spans, background
wiring), so the template shows exactly how the agent is served — request and response bodies are
plain dicts, no wrapper types.

This template is API-first (no bundled UI). Call it with the OpenAI SDK, `curl`, or from your own
frontend / model-serving client.

## Project layout

```
agent/                 # the agent (reasoning plane) — this is what you edit
  agent.py             #   invoke / stream handlers + create_agent_graph()
  tools/               #   function tools — drop a *.py file here to add one (auto-collected)
    sample_tool.py     #     get_current_time — a working example (@tool)
  mcps.py              #   MCP servers: none by default; add to build_mcp_servers() to offer some
  mason/               #   plumbing that will move into Databricks SDKs later — rarely edited
    session_store.py   #     LangGraph checkpointer: in-memory by default; swap for a durable one
    memory.py          #     remember / recall — memory_tools() returns them when AGENT_MEMORY_STORE is set
    tracing.py         #     MLflow tracing setup (on only when a destination + an experiment are set)
    mcp_runtime.py     #     loads tools from the servers in mcps.build_mcp_servers()
    background.py      #     BackgroundRuns: in-memory store for background runs; swap for a durable one
    wire/              #     agent-SDK boundary
      inbound.py       #       get_session_id (request input -> LangGraph messages via the handler)
      outbound.py      #       serialize LangGraph astream events to JSON dicts
server/                # the HTTP surface — SDK-agnostic; rarely edited
  app.py               #   build_app(): FastAPI routes, SSE framing, tracing spans, background wiring
  start_server.py      #   entry point: loads config, builds the app, runs uvicorn
tests/
  test_agent.py        #   hermetic smoke tests + one gated live model call
```

You edit `agent/agent.py`, `agent/tools/`, and `agent/mcps.py`; everything in `agent/mason/` is
plumbing (session checkpointer, tracing, MCP tool loading, wire translation) that's slated to move
into Databricks SDKs, grouped so that migration is a localized change. `server/app.py` is the
SDK-agnostic HTTP surface — it wires two generic handlers (`invoke_handler`/`stream_handler`) to the
endpoints, so the agent SDK lives entirely behind them in `agent/agent.py`. `tools/` is a drop-in
package: add a `*.py` with a `@tool` function and it's auto-collected (no edits to existing code).
`mcps.py` exposes `build_mcp_servers()` (empty by default — add servers to offer them).

## Run locally

No database required. Conversation state is kept in an in-process LangGraph checkpointer.

```bash
# 1. Configure a Databricks auth profile (used only to call the model)
cp .env.example .env
# edit .env: set DATABRICKS_CONFIG_PROFILE=<your-profile>

# 2. Start the server (installs deps via uv on first run)
uv run start-server        # serves at http://localhost:8000

# 3. Send a request
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "What time is it? Use your tool."}]}'
```

The model call goes to your Databricks workspace (via the profile). Everything else — session
storage, tracing — is off by default and requires no setup.

## Client contract

`POST /responses` (and its alias `POST /invocations`) take a JSON body with an `input` list of
**LangChain message dicts** (e.g. `{ "role": "user", "content": "..." }`) — passed straight to the
agent — plus an optional top-level `session_id` for multi-turn. The reply is
`{ "output": [...], "session_id": "..." }`, where `output` is a list of **LangChain message dicts**
(LangGraph's native shape — e.g. `{ "type": "ai", "content": "...", "tool_calls": [...] }`), not
Responses items. Streaming frames are likewise native: `{ "type": "message", "message": {...} }` for
completed messages and `{ "type": "delta", "content": "...", "id": "..." }` for text chunks.

The examples below use `http://localhost:8000` (local dev). When deployed, use
`https://<app>.databricksapps.com` with an `Authorization: Bearer <token>` header.

**Non-streaming:**

```bash
curl -X POST http://localhost:8000/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

**Streaming** (add `"stream": true`) returns an SSE stream ending with `data: [DONE]`.

**Background** (add `"background": true`) returns a `resp_...` id immediately; poll it:

```bash
# returns: { "id": "resp_1a2b3c4d5e6f7g8h9i0j1k2l", "status": "in_progress" }
curl -X POST http://localhost:8000/responses -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "do something" }], "background": true }'

# poll with the returned id until status is "completed"
curl http://localhost:8000/responses/resp_1a2b3c4d5e6f7g8h9i0j1k2l
```

> Background mode here is **in-memory and single-process** — a teaching stand-in. Runs are not
> durable: they do not survive a restart and are not shared across replicas. For production
> durability (crash recovery, cross-pod resume, surviving the ~120s Apps proxy timeout), back it with
> a durable store.

**Multi-turn** — pass the `session_id` returned by the first turn back on the next request:

```bash
# First turn returns: { "output": [...], "session_id": "..." }
curl -X POST http://localhost:8000/responses -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "My name is Alice" }] }'

# Second turn — agent remembers the first (same process; see durability note below)
curl -X POST http://localhost:8000/responses -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "What is my name?" }],
        "session_id": "<session-id>" }'
```

## Customize the agent

- **Model / instructions:** `create_agent_graph()` in `agent/agent.py`.
- **Add a tool:** drop a new file in `agent/tools/` with a `@tool`-decorated function; it's
  collected automatically (see `agent/tools/sample_tool.py`). No wiring to edit.
- **Add an MCP server:** append a `DatabricksMCPServer` to `build_mcp_servers()` in `agent/mcps.py`.
- **Change the session checkpointer:** `agent/mason/session_store.py` (in-memory by default; swap for
  a durable `PostgresSaver` over Lakebase).
- **Add long-term memory:** set `AGENT_MEMORY_STORE` to a managed memory store name; `create_agent_graph()`
  then includes the `remember`/`recall` tools from `agent/mason/memory.py` (persist/search facts across
  conversations). Unset → the model isn't offered them.
- **Change the HTTP surface:** `server/app.py` — routes, SSE framing, background wiring (the run
  store itself is `agent/mason/background.py`).

## Test

```bash
uv run pytest                 # hermetic smoke tests (tools, session, wire)
```

The smoke tests need no auth. `tests/test_agent.py` also has one end-to-end test that calls the
model; it runs only when a workspace profile is configured (`DATABRICKS_CONFIG_PROFILE` or
`DATABRICKS_HOST`+`DATABRICKS_TOKEN`) and skips otherwise.

## Deploy

Deploy to Databricks Apps with the CLI:

```bash
databricks apps deploy agent-langgraph-scratch --source-code-path <workspace-path>
```

`app.yaml` carries the app's start command and env. By default the deployed app is the same lean
backend: in-process session state, tracing off.

### Enable MLflow tracing (optional)

Tracing turns on when MLflow has **both a destination and an experiment** — set one of each, in
whichever form you have. The app code needs no change; MLflow resolves the specific value.

- **Destination:** `MLFLOW_TRACKING_URI` (e.g. `"databricks"`) or `MLFLOW_TRACING_DESTINATION`
  (an experiment id or a `catalog.schema`).
- **Experiment:** `MLFLOW_EXPERIMENT_ID` or `MLFLOW_EXPERIMENT_NAME`.

Set neither half → tracing stays off. Examples:

- **Local:** `MLFLOW_TRACKING_URI="databricks"` + `MLFLOW_EXPERIMENT_ID=<id>` (or `..._NAME=<name>`)
  in `.env`, pointing at an experiment in the workspace your profile targets.
- **Deployed:** set the same env in `app.yaml` and attach an `experiment` resource (its `valueFrom`
  binding injects `MLFLOW_EXPERIMENT_ID`).

When both halves are present the agent enables MLflow autolog (`mlflow.langchain.autolog()`) and tags
each trace with the session id. Otherwise it disables tracing outright, so the per-request span
`server/app.py` opens has nothing to export and no traces are created.

### Enable durable conversation history (optional)

By default the agent uses an in-process LangGraph checkpointer (`InMemorySaver`) — multi-turn works
within a running process but does not survive restarts or span replicas. For durable, shared history,
swap `agent/mason/session_store.py`'s checkpointer for a `PostgresSaver` over Lakebase.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABRICKS_CONFIG_PROFILE` | `DEFAULT` | Auth profile used to call the model (local dev) |
| `PORT` | `8000` | Port the server listens on |
| `AGENT_MEMORY_STORE` | _unset_ | Managed memory store name → registers `remember`/`recall` long-term-memory tools |
| `MLFLOW_TRACKING_URI` | _unset_ | Trace destination (e.g. `databricks`). A destination + an experiment enables tracing |
| `MLFLOW_TRACING_DESTINATION` | _unset_ | Alt destination — experiment id or `catalog.schema` (either destination var works) |
| `MLFLOW_EXPERIMENT_ID` | _unset_ | Experiment to trace to (by id) |
| `MLFLOW_EXPERIMENT_NAME` | _unset_ | Experiment to trace to (by name; alternative to the id) |

## Notes

- **`agent/mason/wire/` is LangGraph-specific** — `inbound` reads the session id (input is converted
  to LangGraph messages in the handler); `outbound` serializes LangGraph's native astream events to
  JSON, without reshaping them into the Responses contract. **`server/app.py` is SDK-agnostic** — it
  hosts any agent exposing the `invoke_handler`/`stream_handler` dict contract.
- **Background mode is in-memory** (`agent/mason/background.py`, wired in `server/app.py`) —
  non-durable, single-process; see the note under the client contract.
