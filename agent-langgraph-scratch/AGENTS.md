# Agent Development Guide

A LangGraph agent backend for Databricks Apps, served from a from-scratch FastAPI app (no serving
framework). Local-first: runs with no database and no setup beyond a Databricks auth profile. MLflow
tracing is optional.

See `README.md` for the full run / deploy / client-contract docs. This file is the quick map for
making changes.

## Run it

```bash
cp .env.example .env          # set DATABRICKS_CONFIG_PROFILE=<your-profile>
uv run start-server           # http://localhost:8000
```

No database needed — conversation state uses an in-process LangGraph checkpointer by default.

## Sample requests

`input` is a list of LangChain message dicts; the reply is `{ "output": [...], "session_id": "..." }`
where `output` is LangChain messages (native shape, not Responses items).

```bash
# Sync — run a turn to completion
curl -sX POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "What time is it? Use your tool."}]}'

# Streaming — SSE frames ending with `data: [DONE]`
curl -sN -X POST http://localhost:8000/responses \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Count to 3."}], "stream": true}'
# frames: {"type":"message","message":{...}} (completed) and {"type":"delta","content":"...","id":"..."}

# Background — returns a resp_ id immediately; poll it
curl -sX POST http://localhost:8000/responses \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Do something slow."}], "background": true}'
# -> {"id": "resp_1a2b3c4d5e6f7g8h9i0j1k2l", "status": "in_progress"}
curl -s http://localhost:8000/responses/resp_1a2b3c4d5e6f7g8h9i0j1k2l
# -> {"id": "resp_1a2b3c4d5e6f7g8h9i0j1k2l", "status": "completed", "output": [...], "session_id": "..."}

# Multi-turn — pass back the returned session_id (same process; in-memory checkpointer)
curl -sX POST http://localhost:8000/responses \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "My name is Alice."}]}'
curl -sX POST http://localhost:8000/responses \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "What is my name?"}], "session_id": "<session-id>"}'
```

## Where things live

| You want to… | Edit |
| --- | --- |
| Change model / instructions | `agent/agent.py` (`create_agent_graph`) |
| Add a function tool | new `*.py` in `agent/tools/` with a `@tool` function (auto-collected) |
| Add an MCP server | append a `DatabricksMCPServer` to `build_mcp_servers()` in `agent/mcps.py` |
| Change how a request maps to a run | `agent/agent.py` (`invoke_handler` / `stream_handler`) |
| Change the session checkpointer | `agent/mason/session_store.py` |
| Change the HTTP surface (routes, SSE, background wiring) | `server/app.py` |
| Change the background-run store (make it durable) | `agent/mason/background.py` |
| Add a test | `tests/` (hermetic; gate model calls on a workspace profile — see `test_agent.py`) |

`server/app.py` is **SDK-agnostic** — it wires two generic handlers (`invoke_handler`/`stream_handler`,
plain `dict -> dict` / `dict -> AsyncGenerator[dict]`) to the endpoints. The agent SDK lives entirely
behind those handlers in `agent/agent.py`, so the serving layer is the same regardless of SDK.

`agent/mason/` holds plumbing (session checkpointer, tracing, MCP tool loading, wire translation)
slated to move into Databricks SDKs — grouped so that migration is localized.

## How tools register

`agent/tools/all_tools()` auto-imports every module in the package and collects every
`@tool`-decorated `BaseTool` it finds. So a tool registers just by existing in a file there —
`create_agent_graph()` calls `all_tools()`. **Do not** edit `agent/agent.py` to add a tool — just add
a file to `agent/tools/`.

## Sessions & durability

- Default: `agent/mason/session_store.py`'s `checkpointer()` returns an in-process `InMemorySaver`,
  keyed per request by `thread_config(session_id)` — no database, multi-turn works in-process.
- For durable, shared history, swap the checkpointer for a `PostgresSaver` over Lakebase.
- Background mode is in-memory / single-process — non-durable. The store is `agent/mason/background.py`
  (wired in `server/app.py`); swap it for a durable backend for cross-restart/replica recovery.

## MLflow tracing

Optional. Set both a destination (`MLFLOW_TRACKING_URI` or `MLFLOW_TRACING_DESTINATION`) and an
experiment (`MLFLOW_EXPERIMENT_ID` or `MLFLOW_EXPERIMENT_NAME`) to enable (`mlflow.langchain.autolog()`);
leave either half unset to skip. `server/app.py` opens a per-request span regardless.

## Quick commands

| Task | Command |
| --- | --- |
| Run locally | `uv run start-server` |
| Test | `uv run pytest` (hermetic; live model test runs only with a profile) |
| Deploy | `databricks apps deploy agent-langgraph-scratch --source-code-path <path>` |

## Notes for maintainers

- `agent/mason/wire/` is LangGraph-specific (inbound request→session id; outbound `astream`
  `updates`/`messages` events→native LangChain-message JSON dicts, not reshaped to Responses).
  `server/app.py` is SDK-agnostic.
