# Agent Template E2E Test Suite

End-to-end tests that validate every agent template works correctly both locally and when deployed as a Databricks App. Each template goes through quickstart setup, local server testing, and full deployment verification.

## Templates

| Template | Conversational | Memory | Special Config |
|---|---|---|---|
| `agent-langgraph` | Yes | None | — |
| `agent-langgraph-short-term-memory` | Yes | Lakebase | Lakebase placeholder in `databricks.yml` |
| `agent-langgraph-long-term-memory` | Yes | Lakebase | Lakebase placeholder in `databricks.yml` |
| `agent-openai-agents-sdk` | Yes | None | — |
| `agent-openai-agents-sdk-short-term-memory` | Yes | Lakebase | Lakebase placeholder in `databricks.yml` |
| `agent-openai-agents-sdk-multiagent` | Yes | None | Uncomments SUBAGENTS, configures Genie space ID + serving endpoint + knowledge assistant in both `agent_server/agent.py` and `databricks.yml` |
| `agent-non-conversational` | No | None | Uses `/invocations` only; payload is `document_text` + `questions`; runs `test_agent.py` instead of `agent-evaluate` |

## Execution Model

```
test_e2e[template]
  │
  ├── 1. clean_template()         # Remove .venv/, uv.lock, .env
  ├── 2. run_quickstart()          # uv run quickstart --profile <p> [--lakebase <l>]
  ├── 3. apply_edits()             # Template-specific file edits
  │
  ├── 4. ┌──────────────────────────────────────────────┐
  │       │  ThreadPoolExecutor (max_workers=2)          │
  │       │                                              │
  │       │  Local                  Deploy               │
  │       │  ─────                  ──────               │
  │       │  start-server (free     bundle deploy        │
  │       │    port)                grant lakebase access │
  │       │  query /responses       wait for RUNNING     │
  │       │  query /invocations     poll /agent/info     │
  │       │  stream /responses      query via OpenAI SDK │
  │       │  run evaluate           query /invocations   │
  │       │                         stream /responses    │
  │       │                         bundle destroy       │
  │       └──────────────────────────────────────────────┘
  │
  └── 5. revert_edits()
```

Local and deploy phases run **in parallel** via `ThreadPoolExecutor`. Either phase can be skipped with `--skip-local` or `--skip-deploy`. Errors from both threads are collected and reported together.

## CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--profile` | `dev` | Databricks CLI profile |
| `--lakebase` | `bbqiu` | Lakebase instance name |
| `--template` | _(all)_ | Run only a specific template |
| `--genie-space-id` | `01f05202dbb51d74b6cccf1b1b1683eb` | Genie space ID for multiagent |
| `--serving-endpoint` | `agents_dev-bbqiu-test-bb-2-25` | Serving endpoint for multiagent |
| `--knowledge-assistant-endpoint` | `agents_dev-bbqiu-test-bb-2-25` | Knowledge assistant endpoint for multiagent |
| `--skip-local` | `False` | Skip local server testing |
| `--skip-deploy` | `False` | Skip deployment testing |

## File Structure

```
.scripts/agent-e2e/
├── conftest.py          # Pytest config: CLI options, fixtures (repo_root, profile, lakebase)
├── helpers.py           # Shell commands (quickstart, start/stop server, deploy/destroy, query endpoints, OAuth, lakebase grants)
├── template_config.py   # Template dataclass, 7 template definitions, pre-test edit specs
├── test_e2e.py          # Single test_e2e() parametrized across templates; orchestrates all phases
└── pyproject.toml       # Dependencies (pytest, openai, requests)
```

## How to Run

All commands must be run from the `.scripts/agent-e2e/` directory (the `pyproject.toml` and `conftest.py` live there):

```bash
cd .scripts/agent-e2e

# Run all 7 templates in parallel (local + deploy for each)
uv run pytest test_e2e.py -v -n 7

# Run all 7 templates in parallel, local only (skip deploy)
uv run pytest test_e2e.py -v -n 7 --skip-deploy

# Sequential with full live output (for debugging)
uv run pytest test_e2e.py -v -n0 -s --skip-deploy

# Single template
uv run pytest test_e2e.py -v --template agent-langgraph

# Deploy only (skip local)
uv run pytest test_e2e.py -v -n 7 --skip-local

# Custom profile and lakebase
uv run pytest test_e2e.py -v -n 7 --profile staging --lakebase my-instance

# Multiagent with custom Genie space and endpoint
uv run pytest test_e2e.py -v --template agent-openai-agents-sdk-multiagent \
  --genie-space-id <UUID> --serving-endpoint <NAME>
```

### Parallelism with pytest-xdist

Templates run in parallel via `pytest-xdist` (`-n <workers>`). Output from parallel workers is captured and only shown on failure. To see full live output (e.g. for debugging), use `-n0 -s` which disables xdist and runs sequentially in the main process.

## Timeouts

| Phase | Timeout |
|---|---|
| quickstart | 5 min |
| start-server | 60s (polls stderr for "Uvicorn running on") |
| query endpoint (local) | 2 min |
| agent-evaluate | 15 min |
| bundle deploy | 5 min |
| bundle destroy | 5 min (best-effort, never raises) |
| wait for app ready | 10 min total: polls state every 30s, then polls `/agent/info` every 10s |

## Design Decisions

**Parallel local + deploy**: Local tests are fast (~2 min) while deploy is slow (~7-10 min). Running both in parallel cuts total time roughly in half. Errors from both threads are collected and reported together.

**Dynamic port allocation**: `start_server()` binds to port 0 to get an OS-assigned free port, avoiding port conflicts when tests run in parallel. No port cleanup fixture is needed.

**Streaming validation**: Both local and deployed endpoints are tested for SSE streaming. The test sends `{"stream": true}` and validates that the response has `text/event-stream` content type and contains at least one `data:` SSE event.

**Bundle destroy after deploy**: The deploy phase runs `bundle destroy --auto-approve` in a finally block to clean up deployed resources. This is best-effort — failures are logged as warnings but never raise, so cleanup issues don't mask test failures.

**App log capture on failure**: When deployed endpoint queries fail, app logs are captured via `databricks apps logs` and printed before re-raising. This provides debugging context without requiring manual investigation.

**Two-phase app readiness**: `wait_for_app_ready` first polls `databricks apps get` until the app reaches RUNNING state, then polls the `/agent/info` endpoint until it returns a non-5xx response. This avoids the unreliability of a fixed sleep and confirms the app is actually serving traffic.

**Lakebase access grants**: For memory-backed templates, the deploy phase grants the app's service principal access to the Lakebase instance using `LakebaseClient`. This creates a role and grants schema, table, and sequence privileges. Best-effort — failures are logged as warnings.

**Endpoint testing strategy**: Conversational templates test `/responses` (JSON), `/invocations` (JSON), and `/responses` (streaming). Deployed apps are additionally tested via the OpenAI SDK to validate the full OAuth + SDK integration path. Non-conversational templates only use `/invocations`.

**Pre-test edits with revert**: Templates contain placeholders (e.g. `<your-lakebase-instance-name>`, `<YOUR-GENIE-SPACE-ID>`) that must be replaced before testing. Edits are applied via string replacement and always reverted in a finally block, keeping templates in pristine state for git. Only the first snapshot of each file is stored so files with multiple edits revert to the true original.

**Phase context manager**: Each test phase is wrapped in a `phase()` context manager that prefixes exceptions with the phase name (e.g. `[setup:quickstart]`), making it easy to identify which phase failed.

**OAuth for deployed apps**: Deployed Databricks Apps require OAuth tokens (not PATs). The suite runs `databricks auth token` to obtain tokens and passes them as Bearer headers.

## Template-Specific Behaviors

**Non-conversational** (`agent-non-conversational`): Sends a financial document with questions instead of chat messages. Expects `{"results": [...]}` with non-empty results. Runs `uv run python test_agent.py` instead of `uv run agent-evaluate`.

**Multiagent** (`agent-openai-agents-sdk-multiagent`): Has the most complex pre-test setup. Uncomments a SUBAGENTS block in `agent_server/agent.py` and fills in Genie space ID and serving endpoint values. Also replaces 3 placeholders in `databricks.yml` (Genie space ID, serving endpoint, knowledge assistant endpoint). Has no evaluate script — validation is via endpoint queries only.

**Lakebase memory templates** (short-term-memory, long-term-memory variants): The quickstart command receives `--lakebase` and the test additionally replaces `<your-lakebase-instance-name>` in `databricks.yml`. During deploy, the app's service principal is granted Lakebase access. This applies to 4 templates across both LangGraph and OpenAI SDK families.
