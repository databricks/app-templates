# Agent Development Guide

A lean LangGraph agent backend for Databricks Apps. Local-first: runs with no database and no setup
beyond a Databricks auth profile. Lakebase durability and MLflow tracing are optional.

See `README.md` for the full run / deploy / client-contract docs. This file is the quick map for
making changes.

## Run it

```bash
cp .env.example .env          # set DATABRICKS_CONFIG_PROFILE=<your-profile>
uv run start-server           # http://localhost:8000
```

No database needed — conversation state uses an in-process LangGraph checkpointer by default.

## Where things live

| You want to… | Edit |
| --- | --- |
| Change model / instructions | `agent/agent.py` (`create_agent_graph`) |
| Add a function tool | new `*.py` in `agent/tools/` with a `@tool` function (auto-collected) |
| Add an MCP server | append a `DatabricksMCPServer` to `build_mcp_servers()` in `agent/mcps.py` |
| Change how a request maps to a run | `agent/agent.py` (`@invoke` / `@stream` handlers) |
| Change the session checkpointer | `agent/mason/session_store.py` |
| Server / durability wiring | `server/start_server.py` (rarely needed) |
| Add a test | `tests/` (hermetic; gate model calls on a workspace profile — see `test_agent.py`) |

`agent/mason/` holds plumbing (session checkpointer, tracing, MCP tool loading, wire translation)
slated to move into Databricks SDKs — grouped so that migration is localized. You rarely edit it;
build the agent in `agent/agent.py`, `agent/tools/`, and `agent/mcps.py`.

## How tools register

`agent/tools/all_tools()` auto-imports every module in the package and collects every
`@tool`-decorated `BaseTool` it finds. So a tool registers just by existing in a file there —
`create_agent_graph()` calls `all_tools()`. **Do not** edit `agent/agent.py` to add a tool — just
add a file to `agent/tools/`.

## Sessions & durability

- Default: `agent/mason/session_store.py`'s `checkpointer()` returns an in-process `InMemorySaver`,
  keyed per request by `thread_config(session_id)` — no database, multi-turn works in-process.
- **Two independent durable stores:**
  - Conversation history → swap the checkpointer for a `PostgresSaver` over Lakebase (durable,
    shared across replicas).
  - `LAKEBASE_AUTOSCALING_ENDPOINT` → `start_server.py` passes it into `LongRunningAgentServer` for
    its durable server store (background mode + crash recovery).
  - Enable either/both/neither.

## MLflow tracing

Optional. Set both `MLFLOW_EXPERIMENT_ID` and `MLFLOW_TRACKING_URI` to enable (`mlflow.langchain.autolog()`);
leave either unset to skip (the server boots with tracing disabled).

## Quick commands

| Task | Command |
| --- | --- |
| Run locally | `uv run start-server` |
| Run via CLI local App runner | `databricks apps run-local --prepare-environment -p <profile>` |
| Test | `uv run pytest` (hermetic; live model test runs only with a profile) |
| Deploy | `databricks apps deploy agent-langgraph-basic --source-code-path <path>` |

## Notes for maintainers

- `agent/mason/wire/` is LangGraph-specific (inbound request→session id; outbound `astream`
  `updates`/`messages` events→Responses wire events).
