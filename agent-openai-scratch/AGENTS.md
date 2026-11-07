# Agent Development Guide

An OpenAI Agents SDK agent backend for Databricks Apps, served from a from-scratch FastAPI app.
Local-first: runs with no database and no setup beyond a Databricks auth profile. A managed session
store and MLflow tracing are optional.

See `README.md` for the full run / deploy / client-contract docs. This file is the quick map for
making changes.

## Run it

```bash
cp .env.example .env          # set DATABRICKS_CONFIG_PROFILE=<your-profile>
uv run start-server           # http://localhost:8000
```

No database needed — sessions use a local SQLite file by default.

For copy-pasteable sample requests (sync / streaming / background / multi-turn), see the
**Client contract** section of `README.md`.

## Where things live

| You want to… | Edit |
| --- | --- |
| Change model / instructions | `agent/agent.py` (`create_agent`) |
| Add a function tool | new `*.py` in `agent/tools/` with a `@function_tool` function (auto-collected) |
| Add an MCP server | append one to `build_mcp_servers()` in `agent/mcps.py` (e.g. `McpServer.from_uc_function(...)` from `databricks_openai.agents`) |
| Change how a request maps to a run | `agent/agent.py` (`invoke_handler` / `stream_handler`) |
| Change the session store | `agent/mason/session_store.py` |
| Change the HTTP surface (routes, SSE, background wiring) | `server/app.py` |
| Change the background-run store (make it durable) | `agent/mason/background.py` |
| Server entry point | `server/start_server.py` (rarely needed) |
| Add a test | `tests/` (hermetic; gate model calls on a workspace profile — see `test_agent.py`) |

`agent/mason/` holds plumbing (session store, tracing, MCP connection lifecycle, wire translation,
background-run store) slated to move into Databricks SDKs — grouped so that migration is localized.
You rarely edit it; build the agent in `agent/agent.py`, `agent/tools/`, and `agent/mcps.py`.

## How the server works

`server/start_server.py` calls `agent.agent.configure()`, then `build_app(invoke_handler,
stream_handler)` from `server/app.py`, and runs uvicorn. `server/app.py` is a plain FastAPI app —
no serving framework, and SDK-agnostic (it only knows the `invoke_handler`/`stream_handler` dict
contract) — that provides `POST /invocations` + `/responses` (sync, `stream: true` SSE, and
`background: true`), `GET /responses/{id}`, and `/health`, wrapping each request in an MLflow span.

**Background mode is in-memory and single-process** — non-durable. The store is
`agent/mason/background.py` (wired in `server/app.py`); swap it for a durable backend for
cross-restart/replica recovery. It demonstrates the submit→poll pattern; it is not production
durability.

## How tools register

`agent/tools/all_tools()` auto-imports every module in the package and collects every
`@function_tool`-decorated `FunctionTool` it finds. So a tool registers just by existing in a file
there — `create_agent()` calls `all_tools()`. **Do not** edit `agent/agent.py` to add a tool — just
add a file to `agent/tools/`.

## Sessions

- Default: `agent/mason/session_store.py`'s `create_session()` returns a local `SQLiteSession` — no database.
- `AGENT_SESSION_STORE` (a managed session store name) → `mason/session_store.py` persists the
  transcript to that store's `agents/v1` items API (durable conversation history). Unset → SQLite.

## MLflow tracing

Optional. Enabled when MLflow has both a destination (`MLFLOW_TRACKING_URI` or
`MLFLOW_TRACING_DESTINATION`) and an experiment (`MLFLOW_EXPERIMENT_ID` or `MLFLOW_EXPERIMENT_NAME`);
`mason/tracing.py` gates on any valid combo. Leave either half unset to skip. See the README's
tracing section.

## Quick commands

| Task | Command |
| --- | --- |
| Run locally | `uv run start-server` |
| Run via CLI local App runner | `databricks apps run-local --prepare-environment -p <profile>` |
| Test | `uv run pytest` (hermetic; live model test runs only with a profile) |
| Deploy | `databricks apps deploy agent-openai-scratch --source-code-path <path>` |

## Notes for maintainers

- `agent/mason/wire/` is OpenAI-Agents-SDK-specific: `inbound`/`outbound` translate the Responses
  wire format to/from the SDK. `server/app.py` is SDK-agnostic — it hosts any agent exposing the
  `invoke_handler`/`stream_handler` dict contract (so another SDK's template can reuse it verbatim).
- `mcp<2` is pinned in `pyproject.toml` because `databricks-openai` imports a symbol removed in
  `mcp` 2.0; remove the pin when `databricks-openai` supports `mcp>=2`.
