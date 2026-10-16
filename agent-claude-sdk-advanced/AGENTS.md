# AGENTS.md — Developer Guide

Instructions for AI assistants and developers working on this codebase.

## Project Overview

This is a **long-running Responses API agent** built with:

- **Claude Agent SDK** (`claude-agent-sdk`) — wraps Claude Code CLI for agentic tool use
- **MLflow** (`mlflow >= 3.10`) — tracing, evaluation, and the `@invoke`/`@stream` decorators
- **FastAPI** — serves the OpenAI Responses API (`POST /responses`, `GET /responses/{id}`)
- **Lakebase** (Databricks PostgreSQL) — persists background task state for connection resilience
- **Databricks Asset Bundles** — deployment to Databricks Apps

The agent routes requests through Databricks AI Gateway to Anthropic Claude (`databricks-claude-sonnet-4-6`) and has access to Bash and custom MCP tools.

## First-Time Setup

### 1. Check authentication

Read `.env` to find `DATABRICKS_CONFIG_PROFILE` (if set), then verify:

```bash
databricks auth profiles
```

If no profile exists or `.env` is missing, run:

```bash
uv run quickstart
```

This creates `.env`, configures the Databricks CLI profile, sets up an MLflow experiment, and optionally provisions Lakebase.

### 2. All CLI commands require the correct profile

Either pass `--profile <profile>` or set the env var:

```bash
databricks <command> --profile <profile>
# or
DATABRICKS_CONFIG_PROFILE=<profile> databricks <command>
```

Without the profile, the CLI may target the wrong workspace.

## Key Files

| File | Purpose |
|------|---------|
| `agent_server/agent.py` | Agent logic — model, system prompt, tools, `@invoke` and `@stream` handlers |
| `agent_server/start_server.py` | FastAPI entrypoint — loads `.env`, configures bridge `LongRunningAgentServer`, starts uvicorn |
| `agent_server/settings.py` | `Settings` (Pydantic) — all config via env vars: model, timeouts, log level |
| `agent_server/evaluate_agent.py` | Evaluation — `mlflow.genai.evaluate()` with conversation simulator and LLM scorers |
| `databricks.yml` | Bundle config — app name, env vars, MLflow experiment, Lakebase resource |
| `scripts/quickstart.py` | One-command setup: auth, `.env`, MLflow experiment, Lakebase |
| `scripts/start_app.py` | Process manager: starts backend + frontend, monitors readiness, handles port conflicts |
| `scripts/preflight.py` | Local server smoke test before deploy |
| `scripts/discover_tools.py` | Workspace scanner: UC functions, tables, vector search, Genie spaces, MCP servers |
| `scripts/grant_lakebase_permissions.py` | Grants Postgres-level permissions to app service principal |
| `scripts/test_long_running_agent.py` | Pytest suite: sync, stream, background+poll, background+stream, cursor resumption |

## Common Tasks

### Run locally

```bash
uv run start-app          # backend (port 8000) + chat UI (port 3000)
uv run start-app --no-ui  # backend only
```

### Deploy

```bash
uv run preflight
databricks bundle deploy --profile <profile>
databricks bundle run agent_claude_sdk_long_running_agent --profile <profile>
```

### Grant Lakebase permissions after deploy

```bash
# Get SP client ID
databricks apps get <app-name> --profile <profile> --output json | jq -r '.service_principal_client_id'

# Grant permissions (specify memory type)
DATABRICKS_CONFIG_PROFILE=<profile> uv run python scripts/grant_lakebase_permissions.py <sp-client-id> \
    --memory-type langgraph-short-term
```

Memory types: `langgraph-short-term`, `langgraph-long-term`, `openai-short-term`. Each has different Postgres tables. The script also grants permissions on `ai_chatbot` and `drizzle` schemas (chat UI persistence).

### Discover workspace tools

```bash
uv run discover-tools
uv run discover-tools --catalog my_catalog --format json
```

### Run tests

```bash
uv run start-server                                          # start server first
uv run pytest scripts/test_long_running_agent.py -v          # local
uv run pytest scripts/test_long_running_agent.py -v -n auto  # parallel
uv run pytest scripts/test_long_running_agent.py -v --agent-url https://<app>.databricksapps.com
```

### Run evaluations

```bash
uv run agent-evaluate
```

Uses `ConversationSimulator` with multi-turn test cases and MLflow scorers (Completeness, Safety, Fluency, RelevanceToQuery, ToolCallCorrectness, etc.).

## How the Agent Works

### Request flow

1. Client sends `POST /responses` (or `/invocations`) with an `input` array of messages
2. `databricks-ai-bridge` `LongRunningAgentServer` checks `background` and `stream` flags
3. For standard requests: calls `@invoke` or `@stream` handler directly
4. For background requests: persists state in Lakebase, starts async execution, returns `response_id`
5. The agent handler in `agent.py`:
   - Gets a Databricks auth token
   - Builds `ClaudeAgentOptions` with AI Gateway URL, model, tools, and system prompt
   - Calls `claude_agent_sdk.query()` which spawns a Claude Code CLI subprocess
   - Converts Claude SDK messages/events to OpenAI Responses API format

### Background mode persistence

The bridge server persists stream events with a `sequence_number`. Clients can:
- **Poll**: `GET /responses/{id}` returns JSON with status and output when completed
- **Stream**: `GET /responses/{id}?stream=true` yields SSE events in real time
- **Resume**: `GET /responses/{id}?stream=true&starting_after=N` skips already-received events

### Tool configuration

Tools are configured in `agent.py`:

- `allowed_tools`: `["Bash", "mcp__custom-tools__*"]` — what the agent can use
- `mcp_servers`: dictionary of MCP server configs passed to Claude Code CLI
- Custom tools are defined with the `@tool` decorator from `claude_agent_sdk`

To add tools, modify `_build_agent_options()` in `agent.py` and update `databricks.yml` with any required resource permissions.

## Configuration Reference

All settings are in `agent_server/settings.py` and configurable via environment variables:

| Env var | Field | Default | Description |
|---------|-------|---------|-------------|
| `MODEL` | `model` | `databricks-claude-sonnet-4-6` | Model name for AI Gateway |
| `SYSTEM_PROMPT` | `system_prompt` | (see settings.py) | Agent system instructions |
| `MAX_TURNS` | `max_turns` | `25` | Max tool-use turns |
| `AI_GATEWAY_URL` | `ai_gateway_url` | (workspace-specific) | Databricks AI Gateway endpoint |
| `TASK_TIMEOUT_SECONDS` | `task_timeout_seconds` | `3600` | Background task hard limit |
| `POLL_INTERVAL_SECONDS` | `poll_interval_seconds` | `1.0` | Server-side poll delay |
| `LOG_LEVEL` | `log_level` | `INFO` | Logging level |

## Deployment Details

### databricks.yml resources

- **App**: `agent-claude-sdk-lra` — the Databricks App
- **MLflow experiment**: ID `1095947298049155` — `CAN_MANAGE` permission
- **Lakebase Postgres resource**: branch/database paths configured by quickstart — `CAN_CONNECT_AND_CREATE` permission

### Environment variables in databricks.yml

The `config.env` section maps env vars for the deployed app. `value_from` references resolve at deploy time:
- `MLFLOW_EXPERIMENT_ID` ← from the `experiment` resource
- `LAKEBASE_AUTOSCALING_ENDPOINT` ← from the `postgres` resource

### Handling deployment errors

If `databricks bundle deploy` fails with "An app with the same name already exists":
- **Bind it**: `databricks bundle bind apps.agent_claude_sdk_long_running_agent <app-name> --profile <profile>`
- **Or delete it**: `databricks apps delete <app-name> --profile <profile>`, then redeploy

### View logs

```bash
databricks apps logs <app-name> --follow --profile <profile>
```

## Dependencies

Core (from `pyproject.toml`):

| Package | Purpose |
|---------|---------|
| `claude-agent-sdk >= 0.1.0` | Claude Code CLI wrapper for agentic interactions |
| `databricks-sdk >= 0.79` | Databricks auth and Lakebase resource lookup |
| `fastapi >= 0.115` | HTTP server for Responses API |
| `uvicorn >= 0.34` | ASGI server |
| `mlflow >= 3.10` | Tracing, evaluation, `@invoke`/`@stream` decorators |
| `databricks-ai-bridge[agent-server] >= 0.19` | Long-running Responses API server backed by Lakebase |
| `pydantic-settings >= 2.0` | Typed configuration from env vars |
| `python-dotenv` | `.env` file loading |

Dev:

| Package | Purpose |
|---------|---------|
| `openai` | Test client for Responses API |
| `databricks-openai` | Authenticated client for deployed app tests |
| `pytest` / `pytest-xdist` | Test runner with parallel execution |
