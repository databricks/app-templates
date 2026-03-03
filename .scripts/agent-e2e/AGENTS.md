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
  |
  |-- 1. clean_template()         # Remove .venv/, uv.lock, .env, .bundle/, .databricks/
  |-- 2. run_quickstart()          # uv run quickstart --profile <p> [--lakebase <l>]
  |-- 3. apply_edits()             # Template-specific file edits (grouped by file)
  |
  |-- 4. +----------------------------------------------+
  |       |  ThreadPoolExecutor (max_workers=2)          |
  |       |                                              |
  |       |  Local                  Deploy               |
  |       |  -----                  ------               |
  |       |  start-server           bundle deploy        |
  |       |    (free port)            (with retry)       |
  |       |  query endpoints:       grant lakebase       |
  |       |    /responses (JSON)      access (if needed) |
  |       |    /invocations (JSON)  bundle run           |
  |       |    /responses (stream)  wait for RUNNING     |
  |       |    /invocations (stream)  + poll /agent/info |
  |       |    OpenAI SDK           query endpoints      |
  |       |    OpenAI SDK (stream)    (same as local,    |
  |       |  run evaluate             with OAuth token,  |
  |       |    OR test_agent.py       retries on 502)    |
  |       |  stop server            bundle destroy       |
  |       +----------------------------------------------+
  |
  +-- 5. revert_edits() + restore databricks.yml
```

Local and deploy phases run **in parallel** via `ThreadPoolExecutor`. Either phase can be skipped with `--skip-local` or `--skip-deploy`. Errors from both threads are collected and reported together.

## CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--profile` | `dev` | Databricks CLI profile |
| `--lakebase` | `bbqiu` | Lakebase instance name |
| `--template` | _(all)_ | Run only specific templates (repeatable) |
| `--genie-space-id` | `01f05202dbb51d74b6cccf1b1b1683eb` | Genie space ID for multiagent |
| `--serving-endpoint` | `agents_dev-bbqiu-test-bb-2-25` | Serving endpoint for multiagent |
| `--knowledge-assistant-endpoint` | `agents_dev-bbqiu-test-bb-2-25` | Knowledge assistant endpoint for multiagent |
| `--skip-local` | `False` | Skip local server testing |
| `--skip-deploy` | `False` | Skip deployment testing |
| `--no-destroy` | `False` | Keep deployed app running after test (skip `bundle destroy`) |

## File Structure

```
.scripts/agent-e2e/
|-- conftest.py          # Pytest config: CLI options, fixtures (repo_root, profile, lakebase)
|-- helpers.py           # Subprocess runners, server lifecycle, endpoint queries, deploy/destroy, OAuth, lakebase grants, file edits
|-- template_config.py   # TemplateConfig/FileEdit dataclasses, databricks.yml parser, 7 template definitions, REPO_ROOT
|-- test_e2e.py          # Single test_e2e() parametrized across templates; orchestrates setup/local/deploy/cleanup phases
+-- pyproject.toml       # Dependencies (pytest, pytest-xdist, openai, requests, databricks-sdk, databricks-ai-bridge)
```

### Module responsibilities

**`template_config.py`** owns all template metadata. `TemplateConfig` carries `name`, `bundle_name`, `dev_app_name`, `app_resource_key`, flags (`is_conversational`, `needs_lakebase_edit`, `has_evaluate`), and `pre_test_edits`. `_parse_databricks_yml` extracts bundle name, app name (with `${bundle.target}` -> `dev`), and the DAB resource key from each template's `databricks.yml` via regex. `build_templates()` constructs all 7 configs at pytest collection time. Also exports `REPO_ROOT` as the canonical repo root path used by `conftest.py` and internally.

**`helpers.py`** provides all side-effectful operations: subprocess execution (`_run_cmd`), thread-safe logging (`_log`, `set_log_file`), template cleanup (`clean_template`), quickstart runner, local server lifecycle (`start_server`/`stop_server` with process group management), HTTP endpoint queries (JSON and SSE streaming), OpenAI SDK queries, file edit application/revert (grouped by file for efficiency), and the full deploy pipeline (`bundle_deploy` with retry/recovery, `_bundle_unbind`, `bundle_run`, `bundle_destroy`, `wait_for_app_ready`, `get_oauth_token`, `grant_lakebase_access`).

**`test_e2e.py`** is the test orchestrator. `test_e2e()` is parametrized across all templates and runs the full pipeline: setup (clean, quickstart, edits) -> parallel local + deploy -> cleanup (revert edits, restore `databricks.yml`). `_query_endpoints` is the shared endpoint validation logic used by both local and deploy phases. `_run_local` and `_run_deploy` are the per-phase entry points submitted to the thread pool.

**`conftest.py`** registers CLI options and exposes `profile`, `lakebase`, and `repo_root` as pytest fixtures.

## How to Run

All commands must be run from the `.scripts/agent-e2e/` directory:

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

# Keep deployed apps running for inspection
uv run pytest test_e2e.py -v --template agent-langgraph --skip-local --no-destroy

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
| query endpoint | 2 min per request |
| agent-evaluate | 15 min |
| bundle deploy | 5 min per attempt, up to 10 retries |
| bundle run | 5 min per attempt, up to 10 retries |
| bundle destroy | 5 min (best-effort, never raises) |
| wait for app ready | polls every 30s: first for RUNNING state (up to 10 polls), then `/agent/info` (up to 10 polls) |

## Design Decisions

**Parallel local + deploy**: Local tests are fast (~2 min) while deploy is slow (~7-10 min). Running both in parallel cuts total time roughly in half. Errors from both threads are collected and reported together.

**Dynamic port allocation**: `start_server()` calls `find_free_port()` which binds to port 0 to get an OS-assigned free port, avoiding port conflicts when tests run in parallel via xdist. No port cleanup fixture is needed.

**Endpoint testing strategy**: Both local and deployed endpoints go through the same `_query_endpoints` validation. Conversational templates test 6 paths: non-streaming `/responses`, non-streaming `/invocations`, streaming `/responses`, streaming `/invocations`, OpenAI SDK (non-streaming), and OpenAI SDK (streaming). Non-conversational templates only test `/invocations` (JSON). Deployed endpoints use OAuth Bearer tokens; local endpoints use no auth (OpenAI SDK gets a dummy key).

**Streaming validation**: SSE streaming tests send `{"stream": true}` and validate that the response has `text/event-stream` content type and contains at least one `data:` SSE event.

**Bundle deploy retry/recovery**: `bundle_deploy` retries up to 10 times with automatic recovery for known transient errors: terraform init failures (wait and retry), MLflow experiment name conflicts (delete experiment and retry), app-already-exists (unbind stale state, bind existing app, retry), and stale-state references (unbind and retry). The `_bundle_unbind` helper is shared across the "already exists" and "stale state" recovery paths.

**Bundle destroy after deploy**: The deploy phase runs `bundle destroy --auto-approve` in a finally block to clean up deployed resources. This is best-effort -- failures are logged as warnings but never raise, so cleanup issues don't mask test failures. Use `--no-destroy` to keep the app running for manual inspection.

**App log capture on failure**: When any part of the deploy phase fails (readiness timeout or endpoint queries), app logs are captured via `databricks apps logs` and printed before re-raising. This provides debugging context without requiring manual investigation.

**Two-phase app readiness**: `wait_for_app_ready` first polls `databricks apps get` until the app reaches RUNNING state, then polls the `/agent/info` endpoint until it returns a non-5xx response. Returns both the app URL and the OAuth token it fetched (so the caller doesn't need to fetch it again). This avoids the unreliability of a fixed sleep and confirms the app is actually serving traffic.

**Deploy endpoint query retries**: After the app is ready, endpoint queries are retried up to 3 times with 30s between attempts to handle transient 502s (common right after lakebase grant). The OAuth token is refreshed on each retry to prevent expiry after long `wait_for_app_ready` waits.

**Lakebase access grants**: For memory-backed templates, the deploy phase grants the app's service principal access to the Lakebase instance. It queries the app to get the SP client ID, then uses `LakebaseClient` to grant CREATE on the database, plus USAGE/CREATE on schemas and ALL on tables/sequences for existing managed schemas (`public`, `drizzle`, `ai_chatbot`). Individual SQL statements use `_try_sql` (best-effort, logs warnings) but the overall function raises on unexpected errors.

**Pre-test edits with revert**: Templates contain placeholders (e.g. `<your-lakebase-instance-name>`, `<YOUR-GENIE-SPACE-ID>`) that must be replaced before testing. Edits are grouped by file path so each file is read and written exactly once, even when multiple edits target the same file. Original content is always reverted in a finally block, and `databricks.yml` is restored to its pre-quickstart state (since quickstart also modifies it).

**Phase context manager**: Each test phase is wrapped in a `phase()` context manager that prefixes exceptions with the phase name (e.g. `[setup:quickstart]`), making it easy to identify which phase failed in error output.

**OAuth for deployed apps**: Deployed Databricks Apps require OAuth tokens (not PATs). The suite uses `databricks auth token -p <profile>` to obtain tokens and passes them as Bearer headers.

**Thread-safe logging**: Each thread writes to its own log file (set via `set_log_file` using thread-local storage). A global lock serializes file writes. Stdout output via `print()` may interleave between threads.

## Template-Specific Behaviors

**Non-conversational** (`agent-non-conversational`): Sends a financial document with questions instead of chat messages. Expects `{"results": [...]}` with non-empty results. Runs `uv run python test_agent.py` instead of `uv run agent-evaluate`. Does not test streaming or OpenAI SDK paths.

**Multiagent** (`agent-openai-agents-sdk-multiagent`): Has the most complex pre-test setup. Uncomments a SUBAGENTS block in `agent_server/agent.py` and fills in Genie space ID and serving endpoint values. Also replaces 3 placeholders in `databricks.yml` (Genie space ID, serving endpoint, knowledge assistant endpoint). Has no evaluate script -- validation is via endpoint queries only.

**Lakebase memory templates** (`*-short-term-memory`, `*-long-term-memory`): The quickstart command receives `--lakebase` and the test additionally replaces `<your-lakebase-instance-name>` in `databricks.yml`. It also replaces `value_from: "database"` for `LAKEBASE_INSTANCE_NAME` env vars with a literal `value:` so the app gets the instance name rather than the PGHOST hostname. During deploy, the app's service principal is granted Lakebase access. This applies to 3 templates across both LangGraph and OpenAI SDK families.
