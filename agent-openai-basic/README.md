# Agent — OpenAI (Basic)

A lean [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) agent **backend** for
Databricks Apps. It runs locally with **no database and no setup** — just an auth profile — and
exposes the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
(`POST /responses`, `POST /invocations`). Durable sessions and long-running background execution
are **opt-in** via [Databricks Lakebase](https://docs.databricks.com/aws/en/lakebase/); without
them the agent uses a local SQLite session store and runs in-request.

This template is API-first (no bundled UI). Call it with the OpenAI SDK, `curl`, or from your own
frontend / model-serving client.

## Project layout

```
agent/                 # the agent (reasoning plane) — this is what you edit
  agent.py             #   @invoke / @stream handlers + create_agent()
  tools/               #   function tools — drop a *.py file here to add one (auto-collected)
    sample_tool.py     #     get_current_time — a working example (@function_tool)
  mcps.py              #   MCP servers: none by default; add to build_mcp_servers() to offer some
  mason/               #   plumbing that will move into Databricks SDKs later — rarely edited
    session_store.py   #     session store: local SQLite by default; managed store when AGENT_SESSION_STORE is set
    memory.py          #     remember / recall — memory_tools() returns them when AGENT_MEMORY_STORE is set
    tracing.py         #     MLflow tracing setup (on only when both MLFLOW_* vars are set)
    mcp_runtime.py     #     connects the servers from mcps.build_mcp_servers() for each request
    wire/              #     Responses <-> agent-SDK translation
      inbound.py       #       request -> run input (session id, input dedup)
      outbound.py      #       SDK stream events -> Responses wire events (surfaces tool outputs)
server/                # the durable plane (LongRunningAgentServer wiring) — rarely edited
  start_server.py      #   builds the server; passes LAKEBASE_AUTOSCALING_ENDPOINT for durability if set
tests/
  test_agent.py        #   hermetic smoke tests + one gated live model call
```

You edit `agent/agent.py`, `agent/tools/`, and `agent/mcps.py`; everything in `agent/mason/` is
plumbing (session store, tracing, MCP connection lifecycle, wire translation) that's slated to move
into Databricks SDKs, grouped so that migration is a localized change. `tools/` is a drop-in package:
add a `*.py` with a `@function_tool` function and it's auto-collected (no edits to existing code).
`mcps.py` exposes `build_mcp_servers()` (empty by default — add servers to offer them).
`mason/session_store.py` defaults to local SQLite and
switches to a Databricks managed session store when `AGENT_SESSION_STORE` is set.

## Run locally

No database required. History is kept in a local SQLite file (`local_agent_sessions.db`).

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

The model call still goes to your Databricks workspace (via the profile). Everything else — session
storage, background mode, tracing — is off by default and requires no setup.

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

# Second turn — agent remembers the first
curl -X POST <base_url>/responses -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "What is my name?" }],
        "custom_inputs": { "session_id": "<session-id>" } }'
```

## Customize the agent

- **Model / instructions:** `create_agent()` in `agent/agent.py`.
- **Add a tool:** drop a new file in `agent/tools/` with a `@function_tool`-decorated function; it's
  collected automatically (see `agent/tools/sample_tool.py`). No wiring to edit.
- **Add an MCP server:** append one to `build_mcp_servers()` in `agent/mcps.py` — e.g.
  `McpServer.from_uc_function(catalog="system", schema="ai")` (from `databricks_openai.agents`,
  handles Databricks OAuth for you).
- **Change the session store:** `agent/mason/session_store.py` (SQLite by default; managed store when `AGENT_SESSION_STORE` is set).
- **Add long-term memory:** set `AGENT_MEMORY_STORE` to a managed memory store name; `create_agent()`
  then includes the `remember`/`recall` tools from `agent/mason/memory.py` (persist/search facts across
  conversations). Unset → the model isn't offered them.

## Test

```bash
uv run pytest                 # hermetic smoke tests (import, tools, sessions, wire)
```

The smoke tests need no auth. `tests/test_agent.py` also has one end-to-end test that calls the
model; it runs only when a workspace profile is configured (`DATABRICKS_CONFIG_PROFILE` or
`DATABRICKS_HOST`+`DATABRICKS_TOKEN`) and skips otherwise.

## Deploy

Deploy to Databricks Apps with the CLI, which provisions any requested resources (experiment,
Lakebase) and wires them into the app:

```bash
databricks apps deploy agent-openai-basic --source-code-path <workspace-path>
```

`app.yaml` carries the app's start command and env. By default the deployed app is the same lean
backend: local SQLite sessions, in-request execution, tracing off. The two features below are
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

When both halves are present the agent enables MLflow autolog and tags each trace with the session
id. Otherwise it disables tracing outright, so the agent-server framework's per-request span is never
created and no traces are exported. Nothing else in the app code changes.

### Enable durable sessions + background mode (optional)

Two independent durable stores, each set via `app.yaml` env:

**Durable conversation history** — `AGENT_SESSION_STORE` = a Databricks managed session store name.
`mason/session_store.py` then persists the transcript to that store's `agents/v1` items API (shared across
replicas, survives restarts) instead of local SQLite.

**Long-running background execution + crash recovery** — a Lakebase instance attached to the app as
a resource named `postgres` (with `CAN_CONNECT_AND_CREATE` — that permission lets the app's service
principal connect and create its `agent_server.*` tables; no manual SQL grant needed) **plus**
`LAKEBASE_AUTOSCALING_ENDPOINT` set to that instance's endpoint (the resource grants access; the env
var is the address — both are needed). `server/start_server.py` passes the endpoint into
`LongRunningAgentServer`, enabling durable background mode (survives the ~120s Apps proxy timeout,
reconnect via `GET /responses/{id}`). Unset → in-request execution.

Enable either, both, or neither. For a fully durable deployment set both — otherwise you can get a
durable server store with a node-local transcript (or vice versa).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABRICKS_CONFIG_PROFILE` | `DEFAULT` | Auth profile used to call the model (local dev) |
| `LOCAL_SESSION_DB_PATH` | `local_agent_sessions.db` | Local SQLite session store path (`:memory:` for ephemeral) |
| `AGENT_SESSION_STORE` | _unset_ | Managed session store name → durable conversation history (else local SQLite) |
| `AGENT_MEMORY_STORE` | _unset_ | Managed memory store name → registers `remember`/`recall` long-term-memory tools |
| `LAKEBASE_AUTOSCALING_ENDPOINT` | _unset_ | Lakebase endpoint → durable background mode + crash recovery (else in-request) |
| `MLFLOW_TRACKING_URI` | _unset_ | Trace destination (e.g. `databricks`). A destination + an experiment enables tracing |
| `MLFLOW_TRACING_DESTINATION` | _unset_ | Alt destination — experiment id or `catalog.schema` (either destination var works) |
| `MLFLOW_EXPERIMENT_ID` | _unset_ | Experiment to trace to (by id) |
| `MLFLOW_EXPERIMENT_NAME` | _unset_ | Experiment to trace to (by name; alternative to the id) |

## Notes

- **`agent/mason/wire/` is OpenAI-Agents-SDK-specific** — under the Responses API the SDK's
  events pass through as-is; this only surfaces tool-call outputs (which the raw event stream
  omits).
- **`mcp<2` pin** (`pyproject.toml`): `databricks-openai` currently imports a symbol removed in
  `mcp` 2.0. Remove the pin once `databricks-openai` supports `mcp>=2`.
