# Claude Agent SDK Long-Running Responses App Template

A long-running agent server built with the [Claude Agent SDK](https://docs.databricks.com/aws/en/generative-ai/agent-framework/) and [MLflow](https://mlflow.org/), deployed as a [Databricks App](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/). Uses Claude Sonnet 4.6 via Databricks AI Gateway (`databricks-claude-sonnet-4-6`) and exposes the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) over FastAPI with background execution, Lakebase persistence, and stream resumption — enabling use cases where agent responses take minutes rather than seconds.

Standard synchronous invoke/stream behavior is fully preserved when `background=false` (default).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Databricks App                                              │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │  Next.js     │───>│  FastAPI      │───>│  Claude Agent  │  │
│  │  Chat UI     │    │  (Responses   │    │  SDK           │  │
│  │  :3000       │    │   API) :8000  │    │                │  │
│  └──────────────┘    └──────┬───────┘    └───────┬────────┘  │
│                             │                    │           │
│                      ┌──────▼───────┐    ┌───────▼────────┐  │
│                      │  Lakebase    │    │  AI Gateway    │  │
│                      │  (PostgreSQL)│    │  (Anthropic)   │  │
│                      └──────────────┘    └────────────────┘  │
│                                                              │
│                      ┌──────────────┐                        │
│                      │  MLflow      │                        │
│                      │  (Tracing)   │                        │
│                      └──────────────┘                        │
└──────────────────────────────────────────────────────────────┘
```

**Components:**

| Component | Purpose |
|-----------|---------|
| **FastAPI server** (`agent_server/`) | Responses API endpoints (`POST /responses`, `GET /responses/{id}`), background task management |
| **Claude Agent SDK** | Wraps Claude Code CLI for agentic interactions with tool use (Bash, MCP tools) |
| **Lakebase (PostgreSQL)** | Persists response status and stream events for background mode and connection resilience |
| **MLflow** | Traces all agent interactions for observability and evaluation |
| **Next.js Chat UI** (`e2e-chatbot-app-next/`) | Pre-built chat frontend that connects to the backend via `API_PROXY` |
| **Databricks AI Gateway** | Routes model requests to Anthropic Claude with auth and rate limiting |

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) package manager
- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html) (`databricks` command)
- Node.js 18+ and npm (for the chat UI)
- A Databricks workspace with:
  - AI Gateway endpoint configured for Anthropic Claude
  - (Optional) Lakebase instance for background mode persistence

## Quick Start

```bash
# 1. First-time setup — configures auth, .env, MLflow experiment, and Lakebase
uv run quickstart

# 2. Start the agent server + chat UI locally
uv run start-app
```

The quickstart script will:
- Prompt for your Databricks CLI profile
- Create/configure the `.env` file with `AI_GATEWAY_URL`
- Set up an MLflow experiment for tracing
- Optionally configure a Lakebase instance for background mode

After startup, the chat UI is available at `http://localhost:3000` and the API at `http://localhost:8000`.

## Project Structure

```
.
├── agent_server/
│   ├── agent.py                 # Agent logic: model, system prompt, tools, stream/invoke handlers
│   ├── start_server.py          # FastAPI entrypoint, bridge LongRunningAgentServer, MLflow setup
│   ├── settings.py              # Pydantic settings (model, timeouts, log level)
│   └── evaluate_agent.py        # Agent evaluation with MLflow scorers
├── scripts/
│   ├── quickstart.py            # One-command setup (auth, .env, MLflow, Lakebase)
│   ├── start_app.py             # Starts backend + frontend with process management
│   ├── preflight.py             # Local server smoke test before deploy
│   ├── discover_tools.py        # Scans workspace for UC functions, tables, vector indexes, etc.
│   ├── grant_lakebase_permissions.py  # Grants Postgres permissions to app service principal
│   └── test_long_running_agent.py     # Pytest suite for all API modes
├── e2e-chatbot-app-next/        # Next.js chat UI (cloned on first run)
├── databricks.yml               # Databricks Asset Bundle config
├── pyproject.toml               # Python dependencies and script entry points
└── .env                         # Local environment variables (not committed)
```

## Configuration

### Environment Variables

Set in `.env` locally or in `databricks.yml` `config.env` for deployed apps:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_GATEWAY_URL` | Yes | — | Databricks AI Gateway URL for Anthropic Claude |
| `LAKEBASE_AUTOSCALING_ENDPOINT` | No | — | Lakebase autoscaling endpoint; preferred for background mode |
| `LAKEBASE_INSTANCE_NAME` | No | — | Provisioned Lakebase instance name; alternative background mode config |
| `MLFLOW_EXPERIMENT_ID` | No | — | MLflow experiment for tracing (set by quickstart or databricks.yml) |
| `TASK_TIMEOUT_SECONDS` | No | `3600` | Max duration for background tasks (1 hour) |
| `POLL_INTERVAL_SECONDS` | No | `1.0` | Server-side polling delay for GET /responses/{id} |
| `LOG_LEVEL` | No | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `CHAT_APP_PORT` | No | `3000` | Port for the chat UI frontend |

### Agent Settings

Configured in `agent_server/settings.py` via environment variables:

| Setting | Default | Description |
|---------|---------|-------------|
| `model` | `databricks-claude-sonnet-4-6` | Model name routed through AI Gateway |
| `system_prompt` | (see settings.py) | System instructions for the agent |
| `max_turns` | `25` | Maximum tool-use turns per request |
| `permission_mode` | `bypassPermissions` | Claude Code permission mode for tool execution |

## Features

### Background Execution Mode

Databricks Apps enforces a ~120s HTTP connection timeout. Background mode (`background=true`) decouples agent execution from the HTTP connection:

1. `POST /responses` with `background=true` returns a `response_id` immediately
2. The bridge server runs the agent asynchronously
3. Clients poll or stream results via `GET /responses/{id}`

Requires configured Lakebase (`LAKEBASE_AUTOSCALING_ENDPOINT` or `LAKEBASE_INSTANCE_NAME`).

### Lakebase Persistence

The `databricks-ai-bridge` long-running server persists response status and stream events in Lakebase.

This enables connection resilience (disconnect and reconnect without losing progress) and cursor-based stream resumption (`starting_after=N`).

### Timeout Protection

The bridge server protects background tasks with a configurable hard limit:

1. `TASK_TIMEOUT_SECONDS` caps each background task (default 1 hour)
2. Clients can poll or resume streaming after individual HTTP connections time out

### MLflow Tracing and Evaluation

All agent interactions are traced via MLflow. Run evaluations with simulated conversations:

```bash
uv run agent-evaluate
```

This uses `mlflow.genai.evaluate()` with scorers for completeness, safety, fluency, relevance, tool correctness, and user frustration.

## Client Contract

Replace `<base_url>` with `http://localhost:8000` (local) or `https://<app-name>.databricksapps.com` (deployed).

### Standard Invoke (blocking)

```python
from openai import OpenAI
client = OpenAI(base_url="<base_url>", api_key="local")

resp = client.responses.create(
    input=[{"role": "user", "content": "What time is it?"}],
)
print(resp.output_text)
```

### Standard Stream (blocking)

```python
stream = client.responses.create(
    input=[{"role": "user", "content": "What time is it?"}],
    stream=True,
)
for event in stream:
    if event.type == "response.output_text.delta":
        print(event.delta, end="")
```

### Background + Poll

```python
resp = client.responses.create(
    input=[{"role": "user", "content": "Run a long analysis..."}],
    background=True,
)
while resp.status in ("queued", "in_progress"):
    time.sleep(2)
    resp = client.responses.retrieve(resp.id)
print(resp.output_text)
```

### Background + Stream (resumable)

```python
stream = client.responses.create(
    input=[{"role": "user", "content": "Run a long analysis..."}],
    stream=True,
    background=True,
)
response_id, last_seq = None, 0
for event in stream:
    if hasattr(event, "response"):
        response_id = event.response.id
    if hasattr(event, "sequence_number"):
        last_seq = event.sequence_number
    process(event)

# Resume if connection dropped
resumed = client.responses.retrieve(response_id, stream=True, starting_after=last_seq)
for event in resumed:
    process(event)
```

### Retrieve Endpoint

`GET /responses/{response_id}`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `stream` | boolean | `false` | `true` returns SSE stream; `false` returns JSON |
| `starting_after` | integer | `0` | Resume SSE stream after this sequence number |

### Mode Summary

| Mode | POST body | POST response | Retrieve |
|------|-----------|---------------|----------|
| Invoke | `{ input }` | JSON `{ output }` | N/A |
| Stream | `{ input, stream: true }` | SSE stream | N/A |
| Background + poll | `{ input, background: true }` | JSON `{ id, status }` | `GET /responses/{id}` |
| Background + stream | `{ input, stream: true, background: true }` | SSE stream | `GET /responses/{id}?stream=true&starting_after=N` |

## Deployment

Deploy to Databricks Apps via [Databricks Asset Bundles](https://docs.databricks.com/dev-tools/bundles/index.html):

```bash
# Deploy the bundle
databricks bundle deploy --profile <profile>

# Start the app
databricks bundle run agent_claude_sdk_long_running_agent --profile <profile>
```

After deploying, grant the app's service principal Lakebase permissions:

```bash
# Get the SP client ID
databricks apps get <app-name> --profile <profile> --output json | jq -r '.service_principal_client_id'

# Grant permissions
DATABRICKS_CONFIG_PROFILE=<profile> uv run python scripts/grant_lakebase_permissions.py <sp-client-id> \
    --memory-type langgraph-short-term
```

### Bundle Resources

Defined in `databricks.yml`:

| Resource | Description |
|----------|-------------|
| MLflow experiment | Tracing and evaluation storage |
| Lakebase database | `doan-agent-memory` instance, `databricks_postgres` database |
| App | `agent-claude-sdk-lra` with environment variables |

## Running Locally

```bash
# Start both frontend and backend
uv run start-app

# Backend only (no chat UI)
uv run start-app --no-ui

# Backend with custom port
uv run start-app --port 9000
```

## Testing

```bash
# Start the server first
uv run start-server

# Run all tests against local server
uv run pytest scripts/test_long_running_agent.py -v

# Run tests in parallel
uv run pytest scripts/test_long_running_agent.py -v -n auto

# Against a deployed app
uv run pytest scripts/test_long_running_agent.py -v --agent-url https://<app-name>.databricksapps.com
```

## Discover Workspace Tools

Scan your Databricks workspace for available tools and data sources:

```bash
uv run discover-tools                         # Markdown output
uv run discover-tools --format json           # JSON output
uv run discover-tools --catalog my_catalog    # Limit to a catalog
```

Discovers Unity Catalog functions, tables, vector search indexes, Genie spaces, custom MCP servers (apps named `mcp-*`), and external MCP servers (UC connections).

## Script Reference

| Command | Script | Description |
|---------|--------|-------------|
| `uv run quickstart` | `scripts/quickstart.py` | First-time setup (auth, .env, MLflow, Lakebase) |
| `uv run start-app` | `scripts/start_app.py` | Start backend + frontend with process management |
| `uv run start-server` | `agent_server/start_server.py` | Start backend only (used by start-app) |
| `uv run preflight` | `scripts/preflight.py` | Start local server and send a smoke-test request |
| `uv run agent-evaluate` | `agent_server/evaluate_agent.py` | Run agent evaluations with MLflow scorers |
| `uv run discover-tools` | `scripts/discover_tools.py` | Discover workspace tools and data sources |

## References

- [Claude Agent SDK — Databricks Docs](https://docs.databricks.com/aws/en/generative-ai/agent-framework/)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [OpenAI Background Streaming Guide](https://developers.openai.com/api/docs/guides/background/#streaming-a-background-response)
- [MLflow ResponsesAgent](https://mlflow.org/docs/latest/genai/flavors/responses-agent-intro/)
- [Databricks Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)
- [Databricks Asset Bundles](https://docs.databricks.com/dev-tools/bundles/index.html)
- [Lakebase (Databricks PostgreSQL)](https://docs.databricks.com/aws/en/lakebase/)
