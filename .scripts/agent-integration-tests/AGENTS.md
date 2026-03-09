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
| `agent-openai-agents-sdk-multiagent` | Yes | None | Uncomments SUBAGENTS in `agent_server/agent.py` (enables genie + serving_endpoint subagents), replaces placeholders in `databricks.yml` (Genie space ID, serving endpoint) |
| `agent-non-conversational` | No | None | Uses `/invocations` only; payload is `document_text` + `questions`; runs `test_agent.py` instead of `agent-evaluate` |

## Execution Model

```
test_e2e[template]
  |
  |-- 1. clean_template()         # Remove .venv/, uv.lock, .env, .bundle/, .databricks/
  |-- 2. setup log file            # Create logs/ dir, clear logs/{template}.log
  |-- 3. run_quickstart()          # uv run quickstart --profile <p> [--lakebase-provisioned-name <l>]
  |-- 4. apply_edits()             # Template-specific file edits (grouped by file)
  |
  |-- 5. +----------------------------------------------+
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
  +-- 6. revert_edits() + restore databricks.yml
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
| `--skip-local` | `False` | Skip local server testing |
| `--skip-deploy` | `False` | Skip deployment testing |
| `--no-destroy` | `False` | Keep deployed app running after test (skip `bundle destroy`) |

## File Structure

```
.scripts/agent-integration-tests/
|-- conftest.py          # Pytest config: CLI options, fixtures (repo_root, profile, lakebase)
|-- helpers.py           # Subprocess runners, server lifecycle, endpoint queries, deploy/destroy, OAuth, lakebase grants, file edits
|-- lakebase_inspect.py  # Standalone utility to inspect a Lakebase instance (schemas, rows, permissions)
|-- template_config.py   # TemplateConfig/FileEdit dataclasses, databricks.yml parser, 7 template definitions, REPO_ROOT
|-- test_e2e.py          # Single test_e2e() parametrized across templates; orchestrates setup/local/deploy/cleanup phases
|-- logs/                # Runtime directory: per-template log files ({template.name}.log)
+-- pyproject.toml       # Dependencies (pytest, pytest-xdist, openai, requests, databricks-sdk, databricks-ai-bridge[memory])
```

### Module responsibilities

**`template_config.py`** owns all template metadata. `TemplateConfig` carries `name`, `dev_app_name`, `app_resource_key`, flags (`is_conversational`, `needs_lakebase_edit`, `has_evaluate`), and `pre_test_edits`. `_parse_databricks_yml` extracts app name (with `${bundle.target}` -> `dev`) and the DAB resource key from each template's `databricks.yml` via regex, and enforces a 30-character max on the resolved app name. `build_templates()` constructs all 7 configs at pytest collection time. Also exports `REPO_ROOT` as the canonical repo root path used by `conftest.py` and internally.

**`helpers.py`** provides all side-effectful operations, organized into sections: **Logging & subprocess** (`_log`, `set_log_file`, `_run_cmd`, `_run_with_retries`), **Setup & cleanup** (`clean_template`, `run_quickstart`, `apply_edits`, `revert_edits`), **Local server** (`find_free_port`, `start_server`, `stop_server`, `run_evaluate`, `run_test_agent`), **Endpoint queries** (`query_endpoint` with `stream` parameter, `query_with_openai_sdk`), **Bundle commands** (`_bundle_unbind`, `bundle_deploy`, `bundle_run`, `bundle_destroy`), **App management** (`get_oauth_token`, `wait_for_app_ready`, `capture_app_logs`), and **Lakebase** (`_try_sql`, `grant_lakebase_access`).

**`test_e2e.py`** is the test orchestrator. `test_e2e()` is parametrized across all templates and runs the full pipeline: setup (clean, quickstart, edits) -> parallel local + deploy -> cleanup (revert edits, restore `databricks.yml`). `_query_endpoints` is the shared endpoint validation logic used by both local and deploy phases. `_run_local` and `_run_deploy` are the per-phase entry points submitted to the thread pool.

**`conftest.py`** registers CLI options and exposes `profile`, `lakebase`, and `repo_root` as pytest fixtures.

## How to Run

All commands must be run from the `.scripts/agent-integration-tests/` directory.

**The default runs both local and deploy phases.** Only add `--skip-deploy` or `--skip-local` when the user explicitly asks for it.

```bash
cd .scripts/agent-integration-tests

# DEFAULT: Run all 7 templates in parallel (local + deploy)
uv run pytest test_e2e.py -v -n 7

# Single template (still runs both local + deploy)
uv run pytest test_e2e.py -v --template agent-langgraph

# Local only — ONLY when explicitly requested
uv run pytest test_e2e.py -v -n 7 --skip-deploy

# Deploy only — ONLY when explicitly requested
uv run pytest test_e2e.py -v -n 7 --skip-local

# Sequential with full live output (for debugging)
uv run pytest test_e2e.py -v -n0 -s

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

### Debugging failures

Each template writes a detailed log to `logs/{template-name}.log` (e.g. `logs/agent-langgraph.log`). These logs contain every subprocess command, exit code, stdout/stderr, and HTTP response — check them first when a test fails. The `logs/` directory is inside `.scripts/agent-integration-tests/`.

## Timeouts

| Phase | Timeout |
|---|---|
| quickstart | 5 min |
| start-server | 60s (polls stderr for "Uvicorn running on" or "Application startup complete") |
| query endpoint | 2 min per request |
| agent-evaluate | 15 min |
| bundle deploy | 5 min per attempt, up to 10 attempts |
| bundle run | 5 min per attempt, up to 10 attempts |
| bundle destroy | 5 min (best-effort, never raises) |
| wait for app ready | polls every 30s: first for RUNNING state (up to 10 polls), then `/agent/info` (up to 10 polls) |

## Design Decisions

**Parallel local + deploy**: Local tests are fast (~2 min) while deploy is slow (~7-10 min). Running both in parallel cuts total time roughly in half. Errors from both threads are collected and reported together.

**Dynamic port allocation**: `start_server()` calls `find_free_port()` which binds to port 0 to get an OS-assigned free port, avoiding port conflicts when tests run in parallel via xdist. No port cleanup fixture is needed.

**Endpoint testing strategy**: Both local and deployed endpoints go through the same `_query_endpoints` validation. Conversational templates test 6 paths: non-streaming `/responses`, non-streaming `/invocations`, streaming `/responses`, streaming `/invocations`, OpenAI SDK (non-streaming), and OpenAI SDK (streaming). Non-conversational templates only test `/invocations` (JSON). Deployed endpoints use OAuth Bearer tokens; local endpoints use no auth (OpenAI SDK gets a dummy key).

**Streaming validation**: SSE streaming tests send `{"stream": true}` and validate that the response has `text/event-stream` content type and contains at least one `data:` SSE event.

**Generic retry with recovery**: `_run_with_retries` provides the shared retry loop for bundle commands. It accepts a `recover(stderr, attempt, max_attempts)` callback that inspects the error and returns `True` to retry or `False` to give up. `bundle_deploy` passes a recovery callback that handles terraform init failures (wait and retry), app-already-exists (unbind stale state, bind existing app, retry), and stale-state references (unbind and retry). `bundle_run` passes a simple sleep-and-retry callback. The `_bundle_unbind` helper is shared across the "already exists" and "stale state" recovery paths.

**Bundle destroy after deploy**: The deploy phase runs `bundle destroy --auto-approve` in a finally block to clean up deployed resources. This is best-effort -- failures are logged as warnings but never raise, so cleanup issues don't mask test failures. Use `--no-destroy` to keep the app running for manual inspection.

**App log capture on failure**: When any part of the deploy phase fails (readiness timeout or endpoint queries), app logs are captured via `databricks apps logs` and printed before re-raising. This provides debugging context without requiring manual investigation.

**Two-phase app readiness**: `wait_for_app_ready` first polls `databricks apps get` until the app reaches RUNNING state, then polls the `/agent/info` endpoint until it returns a non-5xx response. Returns both the app URL and the OAuth token it fetched (so the caller doesn't need to fetch it again). This avoids the unreliability of a fixed sleep and confirms the app is actually serving traffic.

**Deploy endpoint query retries**: After the app is ready, endpoint queries are retried up to 3 times with 30s between attempts to handle transient 502s (common right after lakebase grant). The OAuth token is refreshed on each retry to prevent expiry after long `wait_for_app_ready` waits.

**Lakebase access grants**: For memory-backed templates, the deploy phase grants the app's service principal access to the Lakebase instance. It queries the app to get the SP client ID, then uses `LakebaseClient` to grant CREATE on the database, plus USAGE/CREATE on schemas and ALL on tables/sequences for existing managed schemas (`public`, `drizzle`, `ai_chatbot`). Individual SQL statements use `_try_sql` (best-effort, logs warnings) but the overall function raises on unexpected errors.

**Pre-test edits with revert**: Templates contain placeholders (e.g. `<YOUR-GENIE-SPACE-ID>`) that must be replaced before testing. Quickstart handles lakebase placeholders (`<your-lakebase-instance-name>`) and experiment ID updates (sets the empty `experiment_id` in the app resource to the actual ID) automatically, so the test only needs to apply template-specific edits (e.g. multiagent subagent configuration). Edits are grouped by file path so each file is read and written exactly once, even when multiple edits target the same file. Original content is always reverted in a finally block, and `databricks.yml` is restored to its pre-quickstart state (since quickstart also modifies it).

**Phase context manager**: Each test phase is wrapped in a `phase()` context manager that prefixes exceptions with the phase name (e.g. `[setup:quickstart]`), making it easy to identify which phase failed in error output.

**OAuth for deployed apps**: Deployed Databricks Apps require OAuth tokens (not PATs). The suite uses `databricks auth token -p <profile>` to obtain tokens and passes them as Bearer headers.

**Thread-safe logging**: Each thread writes to its own log file (set via `set_log_file` using thread-local storage). A global lock serializes file writes. Stdout output via `print()` may interleave between threads.

## Template-Specific Behaviors

**Non-conversational** (`agent-non-conversational`): Sends a financial document with questions instead of chat messages. Expects `{"results": [...]}` with non-empty results. Runs `uv run python test_agent.py --url http://localhost:<port>` instead of `uv run agent-evaluate`. Does not test streaming or OpenAI SDK paths.

**Multiagent** (`agent-openai-agents-sdk-multiagent`): Has the most complex pre-test setup. Uncomments a SUBAGENTS block in `agent_server/agent.py` and enables 2 subagents (genie + serving_endpoint). Also replaces placeholders in `databricks.yml` (Genie space ID, serving endpoint; the knowledge assistant placeholder is filled with the serving endpoint value as a stand-in). Runs `agent-evaluate` after endpoint queries.

**Lakebase memory templates** (`*-short-term-memory`, `*-long-term-memory`): The quickstart command receives `--lakebase-provisioned-name` (or `--lakebase-autoscaling-project` + `--lakebase-autoscaling-branch` for autoscaling) and handles all `databricks.yml` modifications: it sets the experiment ID in the app resource and replaces `<your-lakebase-instance-name>` placeholders with the actual instance name. During deploy, the app's service principal is granted Lakebase access. This applies to 3 templates across both LangGraph and OpenAI SDK families.
