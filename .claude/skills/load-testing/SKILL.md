---
name: load-testing
description: "Load test a Databricks App to find its maximum QPS. Use when: (1) User says 'load test', 'benchmark', 'QPS', 'throughput', or 'performance test', (2) User wants to find how many queries per second their app can handle, (3) User wants to set up load testing scripts for their agent, (4) User wants to view load test results/dashboard."
---

# Load Testing Your Databricks App

**Goal:** Find the maximum QPS (queries per second) your Databricks App can support.

**What this skill creates:**
- `load-test-scripts/run_load_test.py` — CLI orchestrator that ramps concurrent users and measures QPS per app
- `load-test-scripts/locustfile.py` — Locust test that sends SSE streaming requests and tracks TTFT
- `load-test-scripts/dashboard_template.py` — Generates an interactive HTML dashboard (Chart.js) from test results
- `load-test-runs/<run-name>/dashboard.html` — Self-contained dashboard with KPI cards, bar charts, ramp progression, and a results table

**What this skill creates:**
- `load-test-scripts/run_load_test.py` — CLI orchestrator that ramps concurrent users and measures QPS per app
- `load-test-scripts/locustfile.py` — Locust test that sends SSE streaming requests and tracks TTFT
- `load-test-scripts/dashboard_template.py` — Generates an interactive HTML dashboard (Chart.js) from test results
- `load-test-runs/<run-name>/dashboard.html` — Self-contained dashboard with KPI cards, bar charts, ramp progression, and a results table

## Before You Start — Gather Context

Before beginning, use the `AskUserQuestion` tool to collect the following from the user:

1. **Do they have existing agent app code in this project?** If yes, read their `agent_server/agent.py` (or equivalent) to understand their SDK (OpenAI Agents SDK, LangGraph, or custom) and how they call their LLM.
2. **Do they want to mock out their agent's LLM calls for load testing?** (Recommended — see Step 1.) If they already have a deployed app they want to test as-is (with real LLM calls), skip to Step 2.
3. **What compute sizes do they want to test?** (Medium, Large, or both)
4. **How many worker configurations do they want to test?** (e.g., 2, 4, 6, 8 workers)
5. **Do they have M2M OAuth credentials (service principal client_id/client_secret)?** — Required for long-running tests. If not, guide them to create one.
6. **What is their `DATABRICKS_HOST`?** (workspace URL)

---

## Step 1: Mock Your Agent's LLM Calls (Recommended)

The goal is to **mock your LLM and tool calls** so you test the Apps infrastructure throughput — not external API latency. This step modifies your existing agent code to swap in a mock LLM client.

**If the user wants to test their real agent (with actual LLM calls), skip to Step 2.** But note that real LLM latency (1-30s per request) will bottleneck your QPS numbers, so you'll be measuring LLM throughput, not Apps infrastructure capacity.

### Why Mock?

- Real LLM calls add 1-30s latency per request, masking the true infrastructure capacity
- You avoid burning FMAPI/token usage during load tests
- You get a clean measurement of what the Apps platform can handle

### How to Mock — Read the User's Code First

**IMPORTANT:** Before making any changes, read the user's existing `agent_server/agent.py` (and related files) to understand:
- Which SDK they use (OpenAI Agents SDK, LangGraph, or custom)
- How their LLM client is initialized
- What tools/functions their agent calls
- How streaming is implemented

Then help them create a mock that matches their existing code structure.

### Mock Timing Configuration

Add two environment variables to `app.yaml` or `databricks.yml` to control mock behavior:
- `MOCK_CHUNK_DELAY_MS` — delay between text chunks in milliseconds (default: `10`)
- `MOCK_CHUNK_COUNT` — number of text chunks per response (default: `80`)

These can be tuned per deployment without code changes.

### For OpenAI Agents SDK Templates

Create a `MockAsyncOpenAI` client in `agent_server/mock_openai_client.py` that replaces `AsyncDatabricksOpenAI`. It should:
- Implement `chat.completions.create()` with `stream=True` support
- Return tool call chunks instantly (simulating the LLM "deciding" to call a tool)
- Return text response chunks with configurable delay (reading `MOCK_CHUNK_DELAY_MS` and `MOCK_CHUNK_COUNT` from env vars)
- Match the response shape the OpenAI Agents SDK expects (`ChatCompletionChunk` objects)

Then in `agent_server/agent.py`, swap in the mock at the top:
```python
from agent_server.mock_openai_client import MockAsyncOpenAI
set_default_openai_client(MockAsyncOpenAI())
set_default_openai_api("chat_completions")
```

The rest of the agent code (handlers, tools, streaming logic) stays unchanged.

### For LangGraph Templates

Create a mock LLM class that replaces `ChatDatabricks`. It should:
- Subclass or duck-type the chat model interface
- Return pre-built `AIMessage` objects with tool calls on the first invocation
- Return text content with configurable streaming delay on subsequent invocations
- Read `MOCK_CHUNK_DELAY_MS` and `MOCK_CHUNK_COUNT` from env vars

In `agent_server/agent.py`, replace the model initialization:
```python
# Before:
# model = ChatDatabricks(endpoint="databricks-claude-sonnet-4")
# After:
from agent_server.mock_llm import MockChatModel
model = MockChatModel()
```

### For Custom Agents

Wrap whatever external API calls you make (LLM, vector search, etc.) with mock implementations that return realistic response shapes with configurable delays.

---

## Step 2: Set Up Load Testing Scripts

Create a `load-test-scripts/` directory in the project with the following files. These scripts are framework-agnostic and work with any Databricks App.

### Directory Structure

```
<project-root>/
  agent_server/                # Existing agent code
  load-test-scripts/           # Load testing scripts (create this)
    run_load_test.py           #   Main CLI — orchestrates Locust tests
    locustfile.py              #   Locust test definition (SSE streaming, TTFT tracking)
    dashboard_template.py      #   Generates interactive HTML dashboard from results
    .env.example               #   Template for env vars
  load-test-runs/              # Test results (auto-created per run)
    <run-name>/
      dashboard.html           #   Interactive dashboard
      test_config.json         #   Test parameters
      <label>/                 #   Per-config Locust CSV results
```

### Required Files

**`locustfile.py`** — Locust load test that:
- Sends `POST /invocations` with `{"input": [...], "stream": true}` to the app
- Parses SSE stream (`data: {json}` lines) and counts chunks until `data: [DONE]`
- Tracks **TTFT** (time to first `data:` line) as a custom Locust metric
- Uses M2M OAuth token exchange (`client_credentials` grant to `{host}/oidc/v1/token`) with auto-refresh
- Implements `StepRampShape` — ramps users from `step_size` to `max_users`, holding each level for `step_duration` seconds

**`run_load_test.py`** — CLI orchestrator that:
- Accepts `--app-url` (repeatable), `--client-id`, `--client-secret`, `--max-users`, `--step-size`, `--step-duration`, `--run-name`, `--dashboard`, `--compute-size`, `--label` flags
- Tests each app URL sequentially (isolated metrics per config)
- Refreshes OAuth token before each app
- Runs healthcheck + warmup before each test
- Saves results to `load-test-runs/<run-name>/<label>/`
- Generates dashboard at the end if `--dashboard` is passed

**`dashboard_template.py`** — Generates a self-contained HTML dashboard with Chart.js:
- KPI cards (best config, peak QPS, lowest latency, total requests)
- Bar charts: QPS by config (median + peak), latency (p50 + p95), TTFT, total requests
- QPS Ramp Progression: line charts with QPS/Latency/Failures tabs and a max-users slider
- Grouped by compute size (medium/large side-by-side)
- Full results table with peak QPS, users at peak, latency percentiles, failure rate
- Can be run standalone: `python dashboard_template.py ../load-test-runs/<run-name>/`

### Install Dependencies

```bash
pip install locust requests
```

---

## Step 3: Deploy Load Testing Apps

Deploy multiple Databricks Apps with varying compute sizes and worker counts.

### Recommended Test Matrix

| Compute Size | Workers | App Name |
|-------------|---------|----------|
| Medium | 2 | `<your-app>-medium-w2` |
| Medium | 4 | `<your-app>-medium-w4` |
| Medium | 6 | `<your-app>-medium-w6` |
| Medium | 8 | `<your-app>-medium-w8` |
| Large | 6 | `<your-app>-large-w6` |
| Large | 8 | `<your-app>-large-w8` |
| Large | 10 | `<your-app>-large-w10` |
| Large | 12 | `<your-app>-large-w12` |

### Configuring Compute Size

**Databricks CLI:**
```bash
databricks apps create <app-name> --compute-size MEDIUM
databricks apps update <app-name> --compute-size LARGE
```

**Databricks UI:** Go to **Compute** > **Apps** > your app > **Edit** > **Configure** > **Compute**.

### Configuring Worker Count

Set `UVICORN_WORKERS` in `databricks.yml` using variables and targets:

```yaml
variables:
  app_name:
    default: "my-agent-medium-w4"
  workers:
    default: "4"

resources:
  apps:
    load_test_app:
      name: ${var.app_name}
      source_code_path: .
      config:
        command: ["/bin/bash", "./scripts/start-app.sh"]
        env:
          - name: UVICORN_WORKERS
            value: ${var.workers}
          - name: MOCK_CHUNK_DELAY_MS
            value: "10"
          - name: MOCK_CHUNK_COUNT
            value: "80"

targets:
  medium-w4:
    default: true
    variables:
      app_name: "my-agent-medium-w4"
      workers: "4"
  large-w8:
    variables:
      app_name: "my-agent-large-w8"
      workers: "8"
```

Your `scripts/start-app.sh` should read the worker count:
```bash
#!/bin/bash
uv run start-server --workers ${UVICORN_WORKERS:-4}
```

### Deploying

```bash
databricks bundle deploy --target medium-w4
databricks bundle run load_test_app --target medium-w4
```

Verify apps are ACTIVE before proceeding:
```bash
databricks apps get <app-name> --output json | jq '{app_status, compute_status, url}'
```

---

## Step 4: Run Load Tests

### Authentication — M2M OAuth (Required for Long Tests)

Load tests can run for hours. **U2M OAuth tokens expire** and break your test mid-run. Use M2M (machine-to-machine) OAuth with a service principal instead.

```bash
export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
export DATABRICKS_CLIENT_ID=<your-client-id>
export DATABRICKS_CLIENT_SECRET=<your-client-secret>
```

### Parameters Reference

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--app-url` | Yes | — | App URL(s) to test (repeatable) |
| `--client-id` | Recommended | `DATABRICKS_CLIENT_ID` env | Service principal client ID |
| `--client-secret` | Recommended | `DATABRICKS_CLIENT_SECRET` env | Service principal client secret |
| `--label` | No | Auto-derived from URL | Human-readable label per app (repeatable) |
| `--compute-size` | No | Auto-detected or `medium` | Compute size tag per app: `medium`, `large` (repeatable) |
| `--max-users` | No | `500` | Maximum concurrent simulated users |
| `--step-size` | No | `20` | Users added per ramp step |
| `--step-duration` | No | `45` | Seconds per ramp step |
| `--spawn-rate` | No | `20` | User spawn rate (users/sec) |
| `--run-name` | No | `<timestamp>` | Name for this run — results saved to `load-test-runs/<run-name>/` |
| `--dashboard` | No | Off | Generate interactive HTML dashboard after tests |

### Example Commands

```bash
cd load-test-scripts/

# Quick single-app test:
python run_load_test.py \
    --app-url https://my-app.aws.databricksapps.com \
    --client-id <ID> --client-secret <SECRET> \
    --dashboard --run-name quick-test

# Full matrix — 8 apps, overnight:
python run_load_test.py \
    --app-url https://my-app-medium-w2.aws.databricksapps.com \
    --app-url https://my-app-medium-w4.aws.databricksapps.com \
    --app-url https://my-app-large-w8.aws.databricksapps.com \
    --app-url https://my-app-large-w10.aws.databricksapps.com \
    --compute-size medium --compute-size medium \
    --compute-size large --compute-size large \
    --max-users 1000 --step-size 20 --step-duration 10 \
    --dashboard --run-name overnight-sweep

# Multiple runs for statistical consistency:
for RUN in r1 r2 r3 r4 r5; do
  python run_load_test.py \
      --app-url ... \
      --client-id <ID> --client-secret <SECRET> \
      --max-users 1000 --step-size 20 --step-duration 10 \
      --run-name my_test_${RUN} --dashboard || break
done
```

### What Happens During a Run

1. **Healthcheck** — verifies the app streams correctly (receives `[DONE]`)
2. **Warmup** — sends sequential requests to warm up the app
3. **Ramp-to-saturation** — steps up concurrent users every `step_duration` seconds
4. **When QPS plateaus** despite adding users, you've found the saturation point

### Estimated Duration

- `(max_users / step_size) * step_duration` seconds per app
- Example: `(1000 / 20) * 10 = 50 steps * 10s = ~8 min` per app
- For 8 apps: ~67 min per run

---

## Step 5: View Results Dashboard

### Opening the Dashboard

```bash
open load-test-runs/<run-name>/dashboard.html
```

### Regenerating the Dashboard

```bash
cd load-test-scripts/
python dashboard_template.py ../load-test-runs/<run-name>/
```

### What the Dashboard Shows

- **KPI Cards** — Best config (peak QPS), overall peak QPS, lowest latency, total requests
- **QPS by Config** — Grouped bars showing median QPS and peak QPS side-by-side
- **Latency by Config** — Grouped bars showing p50 and p95 latency
- **TTFT by Config** — Time to first token (p50 and p95)
- **Total Requests Served** — How many requests each config handled
- **QPS Ramp Progression** — Line charts with tabs for QPS, QPS (excl. failures), Latency, and Failures. Includes a **max-users slider** to zoom into lower concurrency ranges. Charts are grouped by compute size (medium/large).
- **Full Results Table** — All configs with peak QPS, users at peak, latency percentiles, and failure rate
- **Load Test Parameters** — Summary of test configuration for reproducibility

### Interpreting Results

- **Peak QPS** — Maximum QPS at any ramp step. This is the throughput ceiling.
- **Users at Peak** — Concurrent users when peak QPS was achieved. More users beyond this doesn't help.
- **Failure Rate** — Should be 0% or very low. High rates mean the app is overloaded.
- **QPS Ramp Chart** — Look for where the line flattens. That's the saturation point.

### Reference Results (from internal testing)

| Compute | Recommended Workers | Expected Peak QPS |
|---------|--------------------|--------------------|
| Medium | **2** | ~155 QPS |
| Large | **8** (safe default in 6–10 range) | ~280 QPS |

- Large compute delivers ~2.2x the throughput of medium
- More workers is not always better — on medium, 2 workers outperforms 8 by ~40%
- Near-zero failure rate across all configs, even at 1,000 concurrent users

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Auth token expired mid-test | Use M2M OAuth (`--client-id`/`--client-secret`) instead of static tokens |
| Healthcheck fails | Verify app is ACTIVE: `databricks apps get <name> --output json` |
| 0 QPS / no results | Check `load-test-runs/<run-name>/<label>/locust_output.log` for errors |
| Low QPS despite high user count | App is saturated — try more workers or larger compute |
| High failure rate | App is overloaded — reduce `--max-users` or increase workers/compute |
| Dashboard shows no ramp data | Ensure `results_stats_history.csv` exists in each result subdir |
