# Agent Development Guide

A lean OpenAI Agents SDK agent backend for Databricks Apps. Local-first: runs with no database and
no setup beyond a Databricks auth profile. Lakebase durability and MLflow tracing are optional.

See `README.md` for the full run / deploy / client-contract docs. This file is the quick map for
making changes.

## Run it

```bash
cp .env.example .env          # set DATABRICKS_CONFIG_PROFILE=<your-profile>
uv run start-server           # http://localhost:8000
```

No database needed — sessions use a local SQLite file by default.

## Where things live

| You want to… | Edit |
| --- | --- |
| Change model / instructions | `agent/agent.py` (`create_agent`) |
| Add a function tool | new `*.py` in `agent/tools/` with a `@function_tool` function (auto-collected) |
| Add an MCP server | append one to `build_mcp_servers()` in `agent/mcps.py` (e.g. `McpServer.from_uc_function(...)` from `databricks_openai.agents`) |
| Change how a request maps to a run | `agent/agent.py` (`@invoke` / `@stream` handlers) |
| Change the session store | `agent/mason/session_store.py` |
| Server / durability wiring | `server/start_server.py` (rarely needed) |
| Add a test | `tests/` (hermetic; gate model calls on a workspace profile — see `test_agent.py`) |

`agent/mason/` holds plumbing (session store, tracing, MCP connection lifecycle, wire translation)
slated to move into Databricks SDKs — grouped so that migration is localized. You rarely edit it;
build the agent in `agent/agent.py`, `agent/tools/`, and `agent/mcps.py`.

## How tools register

`agent/tools/all_tools()` auto-imports every module in the package and collects every
`@function_tool`-decorated `FunctionTool` it finds. So a tool registers just by existing in a file
there — `create_agent()` calls `all_tools()`. **Do not** edit `agent/agent.py` to add a tool — just
add a file to `agent/tools/`.

## Sessions & durability

- Default: `agent/mason/session_store.py`'s `create_session()` returns a local `SQLiteSession` — no database.
- **Two independent durable stores, each with its own env var:**
  - `AGENT_SESSION_STORE` (a managed session store name) → `mason/session_store.py` persists the
    transcript to that store's `agents/v1` items API (durable conversation history).
  - `LAKEBASE_AUTOSCALING_ENDPOINT` → `start_server.py` passes it into `LongRunningAgentServer` for
    its durable server store (background mode + crash recovery).
  - Enable either/both/neither. Fully durable = set both.

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
| Deploy | `databricks apps deploy agent-openai-basic --source-code-path <path>` |

## Notes for maintainers

- `agent/mason/wire/` is OpenAI-Agents-SDK-specific (inbound request→SDK input; outbound SDK events→wire,
  surfacing tool-call outputs the Responses raw event stream omits).
- `mcp<2` is pinned in `pyproject.toml` because `databricks-openai` imports a symbol removed in
  `mcp` 2.0; remove the pin when `databricks-openai` supports `mcp>=2`.
