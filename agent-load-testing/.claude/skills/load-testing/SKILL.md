---
name: load-testing
description: "Load test a Databricks App to find its maximum QPS. Use when: (1) User says 'load test', 'benchmark', 'QPS', 'throughput', or 'performance test', (2) User wants to find how many queries per second their app can handle, (3) User wants to deploy mock agent apps for load testing, (4) User wants to view load test results/dashboard."
---

# Load Testing Your Databricks App

**Goal:** Find the maximum QPS (queries per second) your Databricks App workload can support.

## Directory Structure

```
agent-load-testing/
  mock-agent-app/            # Mock agent app (based on agent-openai-agents-sdk)
    agent_server/            #   Agent code with MockAsyncOpenAI
    scripts/                 #   start-app.sh
    databricks.yml           #   DAB config with targets per compute/worker combo
    app.yaml                 #   App manifest
    pyproject.toml
  load-test-scripts/         # Load testing scripts
    run_load_test.py         #   Main CLI — runs Locust tests with live progress
    locustfile.py            #   Locust test definition (SSE streaming, TTFT tracking)
    dashboard_template.py    #   Generates interactive HTML dashboard from results
    analyze_results.py       #   CSV parser + summary table
    .env.example             #   Template for env vars
  load-test-runs/            # Test results (one subdirectory per run)
    <run-name>/              #   e.g., overnight-sweep/, 20260402_143022/
      dashboard.html         #     Interactive dashboard
      test_config.json       #     Test parameters
      medium-4w/             #     Per-config Locust results
      large-8w/
      ...
```

## Before You Start — Gather Parameters

Before beginning, use the `AskUserQuestion` tool to collect the following from the user:

1. **Which agent template are they using?** (e.g., `agent-openai-agents-sdk`, `agent-langgraph`, or custom)
2. **Do they already have deployed apps to test, or do they need to set up mock apps first?**
3. **What compute sizes do they want to test?** (Medium, Large, or both)
4. **How many worker configurations do they want to test?** (e.g., 2, 4, 6, 8 workers)
5. **Do they have M2M OAuth credentials (service principal client_id/client_secret)?** — Required for long-running tests. If not, guide them to create one.
6. **What is their `DATABRICKS_HOST`?** (workspace URL)

---

## Step 1: Make Your App Server Code Ready for Load Testing

The goal is to **mock your LLM and tool calls** so you test the Apps infrastructure throughput — not external API latency which would bottleneck your QPS.

### Why Mock?

- Real LLM calls add 1-30s latency per request, masking the true infrastructure capacity
- You avoid burning FMAPI/token usage during load tests
- You get a clean measurement of what the Apps platform can handle

### How to Mock

Create a `MockAsyncOpenAI` client that replaces the real LLM client. This client simulates:
1. **Tool call (Call 1):** LLM "decides" to call a tool — streams tool call chunks instantly
2. **Text response (Call 2):** LLM "summarizes" the tool output — streams text chunks with configurable delay

The mock timing is controlled by two environment variables:
- `MOCK_CHUNK_DELAY_MS` — delay between text chunks in milliseconds (default: `10`)
- `MOCK_CHUNK_COUNT` — number of text chunks per response (default: `80`)

### Reference Implementation

See the mock agent app in `agent-load-testing/mock-agent-app/` which is based on the `agent-openai-agents-sdk` template:

| File | Purpose |
|------|---------|
| `mock-agent-app/agent_server/mock_openai_client.py` | `MockAsyncOpenAI` — drop-in replacement for `AsyncDatabricksOpenAI`. Handles tool call streaming (instant) and text response streaming (delayed). |
| `mock-agent-app/agent_server/agent.py` | Uses `set_default_openai_client(MockAsyncOpenAI())` to swap in the mock. The `@invoke()` and `@stream()` handlers are identical to the real template. |
| `mock-agent-app/agent_server/utils.py` | Converts OpenAI Agents SDK `StreamEvent`s into `ResponsesAgentStreamEvent`s for the MLflow agent server. |

**Key pattern** — in `agent.py`, the only change from the real template is two lines at the top:
```python
from agent_server.mock_openai_client import MockAsyncOpenAI
set_default_openai_client(MockAsyncOpenAI())
set_default_openai_api("chat_completions")
```

Everything else (agent definition, handlers, tools) stays the same.

### Adapting for Other Templates

For **LangGraph** templates, mock at the LLM level by replacing the `ChatDatabricks` model with a mock that returns pre-built `AIMessage` objects with tool calls and text content.

For **custom agents**, wrap whatever external API calls you make (LLM, vector search, etc.) with mock implementations that return realistic response shapes with configurable delays.

---

## Step 2: Deploy Load Testing Apps

Once your mock agent server code is ready, deploy multiple Databricks Apps with varying compute sizes and worker counts to find the optimal configuration.

### Recommended Test Matrix

| Compute Size | Workers | App Name |
|-------------|---------|----------|
| Medium | 2 | `agent-load-test-medium-w2` |
| Medium | 4 | `agent-load-test-medium-w4` |
| Medium | 6 | `agent-load-test-medium-w6` |
| Medium | 8 | `agent-load-test-medium-w8` |
| Large | 6 | `agent-load-test-large-w6` |
| Large | 8 | `agent-load-test-large-w8` |
| Large | 10 | `agent-load-test-large-w10` |
| Large | 12 | `agent-load-test-large-w12` |

### Configuring Compute Size

Supported compute sizes: `MEDIUM`, `LARGE`.

**Option A: Databricks CLI** (recommended for scripted setup)

Set compute size when creating a new app:
```bash
databricks apps create agent-load-test-medium-w4 --compute-size MEDIUM
```

Or update an existing app's compute size:
```bash
databricks apps update agent-load-test-medium-w4 --compute-size LARGE
```

You can also pass the full config as JSON:
```bash
databricks apps create agent-load-test-large-w8 \
    --compute-size LARGE \
    --description "Mock agent for load testing (large, 8 workers)"
```

**Option B: Databricks UI**

1. Go to **Compute** > **Apps** in your workspace
2. Find your app and click **Edit**
3. Under **Configure** > **Compute**, select `Medium` or `Large`

**Verify compute size:**
```bash
databricks apps get agent-load-test-medium-w4 --output json | jq '.compute'
# Output: { "size": "MEDIUM" }
```

### Configuring Worker Count

Worker count is controlled by the `UVICORN_WORKERS` environment variable in your app. Set this in `databricks.yml`:

```yaml
bundle:
  name: agent-load-test

variables:
  app_name:
    description: "App name for deployment"
    default: "agent-load-test-medium-w4"
  workers:
    description: "Number of uvicorn workers"
    default: "4"

resources:
  apps:
    load_test_app:
      name: ${var.app_name}
      description: "Mock agent for load testing"
      source_code_path: .
      config:
        command: ["/bin/bash", "./scripts/start-app.sh"]
        env:
          - name: MLFLOW_TRACKING_URI
            value: "databricks"
          - name: UVICORN_WORKERS
            value: ${var.workers}
          - name: MOCK_CHUNK_DELAY_MS
            value: "10"
          - name: MOCK_CHUNK_COUNT
            value: "80"

targets:
  medium-w4:
    default: true
    mode: development
    variables:
      app_name: "agent-load-test-medium-w4"
      workers: "4"
  large-w8:
    mode: development
    variables:
      app_name: "agent-load-test-large-w8"
      workers: "8"
```

Your `scripts/start-app.sh` should read the worker count:
```bash
#!/bin/bash
uv run start-server --workers ${UVICORN_WORKERS:-4}
```

### Deploying

Deploy each target using DAB (see the **/deploy** skill for full details):

```bash
# Deploy a specific target (e.g., medium with 4 workers)
databricks bundle deploy --target medium-w4
databricks bundle run load_test_app --target medium-w4

# Deploy large with 8 workers
databricks bundle deploy --target large-w8
databricks bundle run load_test_app --target large-w8
```

**Verify all apps are in ACTIVE state before proceeding:**
```bash
databricks apps get agent-load-test-medium-w4 --output json | jq '{app_status, compute_status, url}'
```

---

## Step 3: Set Up Load Testing Parameters

### Prerequisites

Install load testing dependencies (from the `agent-load-testing/` directory):

```bash
pip install locust requests
```

Or if using uv:
```bash
uv pip install locust requests
```

### Authentication — M2M OAuth (Required for Long Tests)

Load tests can run for hours. **U2M OAuth tokens will expire** and break your test mid-run. Use M2M (machine-to-machine) OAuth with a service principal instead.

**Create a service principal** (if you don't have one):
```bash
databricks account service-principals create --display-name "load-test-agent" --active true
```

**Generate an OAuth secret:**
```bash
databricks account service-principals secrets create --service-principal-id <SP_ID>
```

Save the `client_id` and `client_secret` — the secret is shown only once.

**Grant the service principal CAN_MANAGE permission** on each app you want to test.

### Parameters Reference

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--app-url` | Yes* | `DEFAULT_APP_URLS` list | App URL(s) to test (repeatable) |
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
| `--skip-healthcheck` | No | Off | Skip pre-test streaming healthcheck |
| `--skip-warmup` | No | Off | Skip warmup requests |

*If `--app-url` is not provided, the script falls back to the `DEFAULT_APP_URLS` list in `load-test-scripts/run_load_test.py`. You can edit this list to hardcode your app URLs.

### Environment Variables

Set these before running (or pass via CLI flags):

```bash
export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
export DATABRICKS_CLIENT_ID=<your-client-id>
export DATABRICKS_CLIENT_SECRET=<your-client-secret>
```

### Example Commands

```bash
cd agent-load-testing/load-test-scripts/

# Quick single-app test with dashboard:
python run_load_test.py \
    --app-url https://agent-load-test-medium-w4.aws.databricksapps.com \
    --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> \
    --dashboard --run-name quick-test

# Full matrix — multiple apps with labels and compute tags:
python run_load_test.py \
    --app-url https://agent-load-test-medium-w4.aws.databricksapps.com \
    --app-url https://agent-load-test-large-w8.aws.databricksapps.com \
    --label medium-4w --label large-8w \
    --compute-size medium --compute-size large \
    --max-users 500 --step-size 20 --step-duration 45 \
    --dashboard --run-name full-sweep

# Overnight run with env vars (no CLI credential flags needed):
export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
export DATABRICKS_CLIENT_ID=<CLIENT_ID>
export DATABRICKS_CLIENT_SECRET=<CLIENT_SECRET>
python run_load_test.py \
    --app-url https://agent-load-test-medium-w2.aws.databricksapps.com \
    --app-url https://agent-load-test-medium-w4.aws.databricksapps.com \
    --app-url https://agent-load-test-medium-w6.aws.databricksapps.com \
    --app-url https://agent-load-test-medium-w8.aws.databricksapps.com \
    --app-url https://agent-load-test-large-w6.aws.databricksapps.com \
    --app-url https://agent-load-test-large-w8.aws.databricksapps.com \
    --app-url https://agent-load-test-large-w10.aws.databricksapps.com \
    --app-url https://agent-load-test-large-w12.aws.databricksapps.com \
    --dashboard --run-name overnight-sweep
```

---

## Step 4: Run Load Tests with Locust

The `load-test-scripts/run_load_test.py` script runs each app URL sequentially through a ramp-to-saturation load test using Locust.

### What Happens During a Run

1. **Healthcheck** — verifies the app streams correctly (receives `[DONE]`)
2. **Warmup** — sends 10 sequential requests to warm up the app
3. **Ramp-to-saturation** — steps up concurrent users every `step_duration` seconds:
   - e.g., 20 users -> 40 -> 60 -> ... -> 500 (with `--step-size 20 --max-users 500`)
   - At each step, measures QPS, latency (p50/p95/p99), TTFT, and failure rate
4. **When QPS plateaus** despite adding users, you've found the saturation point

### Running

```bash
cd agent-load-testing/load-test-scripts/

python run_load_test.py \
    --app-url https://your-app.aws.databricksapps.com \
    --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> \
    --dashboard \
    --run-name my-test
```

The user can optionally specify `--run-name` to name the run. Results are saved to `load-test-runs/<run-name>/`. If omitted, a timestamp is used.

### Live Progress

The script shows real-time progress during the test:

```
  [████████░░░░░░░░░░░░] 160/500 users | QPS:  12.3 | p50:   890ms | p95:  1200ms | Reqs:  1,234 | Fail: 0.0% | 4m32s
```

### Estimated Duration

Each app test takes approximately:
- `(max_users / step_size) * step_duration` seconds
- Example: `(500 / 20) * 45 = 25 steps * 45s = ~19 minutes` per app

For 8 apps: ~2.5 hours total.

---

## Step 5: View Load Testing Dashboard Results

When your load tests complete (with `--dashboard` flag), an interactive HTML dashboard is generated automatically.

### Opening the Dashboard

```bash
open load-test-runs/<run-name>/dashboard.html
```

For example:
```bash
open load-test-runs/overnight-sweep/dashboard.html
```

### Regenerating the Dashboard

You can also regenerate the dashboard from existing results at any time:

```bash
cd agent-load-testing/load-test-scripts/
python dashboard_template.py ../load-test-runs/<run-name>/
```

### What the Dashboard Shows

- **KPI Cards** — Best config (peak QPS), overall peak QPS, lowest latency, total requests
- **Peak QPS by Config** — Bar chart comparing peak QPS across all configurations
- **Latency by Config** — Grouped bars showing p50 and p95 latency
- **TTFT by Config** — Time to first token (p50 and p95)
- **Total Requests Served** — How many requests each config handled
- **QPS Ramp Progression** — Line charts showing QPS vs concurrent users per compute group (medium/large), with tabs to toggle between QPS and latency views. This is where you see the saturation point.
- **Full Results Table** — All configs with peak QPS, users at peak, latency percentiles, and failure rate. The best config is highlighted.
- **Load Test Parameters** — Summary of the test configuration

### Results Directory Structure

```
load-test-runs/<run-name>/
  dashboard.html                    # Interactive dashboard
  test_config.json                  # Test parameters (read by dashboard)
  medium-4w/                        # Per-config results
    results_stats.csv               # Aggregate statistics
    results_stats_history.csv       # Per-second time series
    report.html                     # Locust's built-in HTML report
    locust_output.log               # Raw Locust output
  large-8w/
    ...
```

### Interpreting Results

- **Peak QPS** — The maximum QPS observed at any ramp step. This is the throughput ceiling for that config.
- **Users at Peak** — The number of concurrent users when peak QPS was achieved. Adding more users beyond this point doesn't increase throughput.
- **Failure Rate** — Should be 0% or very low. High failure rates indicate the app is overloaded.
- **QPS Ramp Chart** — Look for where the line flattens (plateaus). That's your saturation point. If it drops, the app is being overwhelmed.

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

## Next Steps

- Compare results across compute sizes and worker counts to find the optimal configuration
- Test with different `MOCK_CHUNK_DELAY_MS` and `MOCK_CHUNK_COUNT` values to simulate different workload profiles
- Once you know your peak QPS, configure your production app with the best compute/worker combo
