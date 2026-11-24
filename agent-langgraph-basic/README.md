# Agent — LangGraph (Basic)

A lean [LangGraph](https://langchain-ai.github.io/langgraph/) agent **backend** for Databricks Apps.
It runs locally with **no database and no setup** — just an auth profile — and exposes the
[OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) (`POST /responses`,
`POST /invocations`). Durable long-running background execution is **opt-in** via
[Databricks Lakebase](https://docs.databricks.com/aws/en/lakebase/); without it the agent keeps
conversation state in an in-process checkpointer and runs in-request.

This template is API-first (no bundled UI). Call it with the OpenAI SDK, `curl`, or from your own
frontend / model-serving client.

## Project layout

```
agent/                 # the agent (reasoning plane) — this is what you edit
  agent.py             #   @invoke / @stream handlers + create_agent_graph()
  tools/               #   function tools — drop a *.py file here to add one (auto-collected)
    sample_tool.py     #     get_current_time — a working example (@tool)
  mcps.py              #   MCP servers: none by default; add to build_mcp_servers() to offer some
  mason/               #   plumbing that will move into Databricks SDKs later — rarely edited
    session_store.py   #     LangGraph checkpointer: in-memory by default; swap for a durable one
    memory.py          #     remember / recall — memory_tools() returns them when AGENT_MEMORY_STORE is set
    tracing.py         #     MLflow tracing setup (on only when both MLFLOW_* vars are set)
    mcp_runtime.py     #     loads tools from the servers in mcps.build_mcp_servers()
    wire/              #     Responses <-> LangGraph translation
      inbound.py       #       request -> session id (LangGraph thread_id)
      outbound.py      #       LangGraph astream events -> Responses wire events
server/                # the durable plane (LongRunningAgentServer wiring) — rarely edited
  start_server.py      #   builds the server; passes LAKEBASE_AUTOSCALING_ENDPOINT for durability if set
tests/
  test_agent.py        #   hermetic smoke tests + one gated live model call
```

You edit `agent/agent.py`, `agent/tools/`, and `agent/mcps.py`; everything in `agent/mason/` is
plumbing (session checkpointer, tracing, MCP tool loading, wire translation) that's slated to move
into Databricks SDKs, grouped so that migration is a localized change. `tools/` is a drop-in
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

You can also launch it through the Databricks CLI's local App runner:

```bash
databricks apps run-local --prepare-environment
```

The model call goes to your Databricks workspace (via the profile). Everything else — durable
background mode, tracing — is off by default and requires no setup.

## Client contract

`POST /responses` (and its alias `POST /invocations`) implement the OpenAI Responses API. Replace
`<base_url>` with `http://localhost:8000` locally, or `https://<app>.databricksapps.com` (with an
`Authorization: Bearer <token>` header) when deployed.

**Non-streaming:**

```bash
curl -X POST <base_url>/responses \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

**Streaming** (add `"stream": true`) returns an SSE stream ending with `[DONE]`.

**Multi-turn** — pass the `session_id` returned in `custom_outputs` back on the next request:

```bash
# First turn returns: "custom_outputs": { "session_id": "..." }
curl -X POST <base_url>/responses -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "My name is Alice" }] }'

# Second turn — agent remembers the first (same process; see durability note below)
curl -X POST <base_url>/responses -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "What is my name?" }],
        "custom_inputs": { "session_id": "<session-id>" } }'
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

## Test

```bash
uv run pytest                 # hermetic smoke tests (tools, session, wire)
```

The smoke tests need no auth. `tests/test_agent.py` also has one end-to-end test that calls the
model; it runs only when a workspace profile is configured (`DATABRICKS_CONFIG_PROFILE` or
`DATABRICKS_HOST`+`DATABRICKS_TOKEN`) and skips otherwise.

## Deploy

Deploy to Databricks Apps with the CLI, which provisions any requested resources (experiment,
Lakebase) and wires them into the app:

```bash
databricks apps deploy agent-langgraph-basic --source-code-path <workspace-path>
```

`app.yaml` carries the app's start command and env. By default the deployed app is the same lean
backend: in-process session state, in-request execution, tracing off. The features below are
independent — enable either, both, or neither.

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
each trace with the session id. Otherwise it disables tracing outright, so the agent-server
framework's per-request span is never created and no traces are exported.

### Enable durable background mode (optional)

**Long-running background execution + crash recovery** — a Lakebase instance attached to the app as
a resource named `postgres` (with `CAN_CONNECT_AND_CREATE` — that permission lets the app's service
principal connect and create its `agent_server.*` tables; no manual SQL grant needed) **plus**
`LAKEBASE_AUTOSCALING_ENDPOINT` set to that instance's endpoint (the resource grants access; the env
var is the address — both are needed). `server/start_server.py` passes the endpoint into
`LongRunningAgentServer`, enabling durable background mode (survives the ~120s Apps proxy timeout,
reconnect via `GET /responses/{id}`). Unset → in-request execution.

**Durable conversation history** is a separate concern from the background store. By default the
agent uses an in-process LangGraph checkpointer (`InMemorySaver`) — multi-turn works within a
running process but does not survive restarts or span replicas. For durable, shared history, swap
`agent/mason/session_store.py`'s checkpointer for a `PostgresSaver` over the same Lakebase.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABRICKS_CONFIG_PROFILE` | `DEFAULT` | Auth profile used to call the model (local dev) |
| `AGENT_MEMORY_STORE` | _unset_ | Managed memory store name → registers `remember`/`recall` long-term-memory tools |
| `LAKEBASE_AUTOSCALING_ENDPOINT` | _unset_ | Lakebase endpoint → durable background mode + crash recovery (else in-request) |
| `MLFLOW_TRACKING_URI` | _unset_ | Trace destination (e.g. `databricks`). A destination + an experiment enables tracing |
| `MLFLOW_TRACING_DESTINATION` | _unset_ | Alt destination — experiment id or `catalog.schema` (either destination var works) |
| `MLFLOW_EXPERIMENT_ID` | _unset_ | Experiment to trace to (by id) |
| `MLFLOW_EXPERIMENT_NAME` | _unset_ | Experiment to trace to (by name; alternative to the id) |

## Notes

- **`agent/mason/wire/` is LangGraph-specific** — it converts Responses input to LangGraph messages
  and maps `astream` events (completed node outputs + token chunks) back to Responses wire events.
