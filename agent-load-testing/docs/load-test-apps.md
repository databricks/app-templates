# Load test your Databricks App

Load testing finds the maximum queries per second (QPS) your Databricks App can sustain before performance degrades. This guide walks you through deploying a mock version of your agent (to isolate infrastructure throughput from LLM latency), running a ramp-to-saturation load test with [Locust](https://locust.io/), and analyzing results via an interactive dashboard.

You can follow the AI-assisted path using a Claude Code skill, or set up each step manually.

> **Note:** This guide measures Databricks Apps **infrastructure throughput**. By mocking LLM calls, you test how many concurrent requests the platform can serve — independent of external API latency (which typically adds 1-30 seconds per request). To measure end-to-end latency including your LLM, skip the mocking step and test against your real agent.

## Requirements

- A Databricks workspace with [Databricks Apps enabled](/aws/en/dev-tools/databricks-apps/index.html)
- An agent app deployed (or ready to deploy) on Databricks Apps using the OpenAI Agents SDK, LangGraph, or a custom framework
- [Databricks CLI](/aws/en/dev-tools/cli/install.html) installed and authenticated (`databricks auth login`)
- Python 3.10+ with [`uv`](https://docs.astral.sh/uv/) package manager
- (For tests over ~1 hour) A service principal with M2M OAuth credentials (`client_id` and `client_secret`). See [Service principal authentication](/aws/en/dev-tools/auth/oauth-m2m.html). For shorter tests, U2M credentials from `databricks auth login` are sufficient.
- (For the AI-assisted path) [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed

## AI-assisted setup (recommended)

If you use Claude Code, the `/load-testing` skill automates the entire workflow — it reads your existing agent code, generates a tailored mock, creates load testing scripts, and guides you through deployment and analysis.

### Step 1: Clone the load testing template

```bash
git clone https://github.com/databricks/app-templates.git
cd app-templates/agent-load-testing
```

The `/load-testing` skill is bundled into all agent templates in the [databricks/app-templates](https://github.com/databricks/app-templates) repository. If you already have a project from `app-templates`, you already have the skill.

### Step 2: Run the load testing skill

In Claude Code, run:

```
/load-testing
```

The skill interactively walks you through:

1. **Gathering parameters** — asks about your deployment status, compute sizes, worker configurations, and OAuth credentials
2. **Creating load test scripts** — generates `locustfile.py`, `run_load_test.py`, and `dashboard_template.py` tailored to your project
3. **Mocking your LLM** — creates a mock client specific to your SDK (OpenAI Agents SDK, LangGraph, or custom) that replaces real LLM calls with configurable streaming delays
4. **Deploying test apps** — guides you through deploying multiple app configurations with different compute sizes and worker counts
5. **Running tests** — executes the load test with ramp-to-saturation (using U2M or M2M OAuth depending on test duration)
6. **Generating results** — produces an interactive HTML dashboard with QPS, latency, and failure metrics

> **Tip:** The skill is interactive — you can skip mocking to test your real agent, or skip deployment if your apps are already running.

## Manual setup

Follow these steps to set up and run load tests without AI assistance.

### Step 1: Understand why mocking matters

Real LLM calls add 1-30 seconds of latency per request. During a load test, this latency becomes the bottleneck and masks the true infrastructure capacity of your Databricks App. You end up measuring how fast the LLM responds — not how many concurrent requests the platform can serve.

By replacing LLM calls with a mock that returns canned responses with configurable streaming delay, you measure the maximum QPS the Apps platform can deliver. The mock preserves the full request/response pipeline — SSE streaming, tool dispatch, SDK runner — and only swaps out the LLM itself.

Mocking also avoids burning Foundation Model API tokens or incurring costs during load tests.

The mock timing is controlled by two environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_CHUNK_DELAY_MS` | `10` | Delay in milliseconds between streamed text chunks |
| `MOCK_CHUNK_COUNT` | `80` | Number of text chunks per response |

With the defaults, each mock response takes approximately 800ms (10ms x 80 chunks) — significantly faster than a real LLM response (3-15 seconds), giving you a clean throughput measurement.

### Step 2: Mock your agent's LLM calls

Create a mock client that replaces the real LLM client, keeping the rest of your agent code unchanged. The approach depends on your SDK.

A reference mock implementation is available in the `app-templates` repository:

```bash
git clone https://github.com/databricks/app-templates.git
# Reference mock: app-templates/agent-load-testing/mock-agent-app/
```

#### OpenAI Agents SDK

Create `agent_server/mock_openai_client.py` — a `MockAsyncOpenAI` class that implements `chat.completions.create()` with streaming. It returns tool call chunks instantly (simulating the LLM deciding to call a tool) and text response chunks with configurable delay from `MOCK_CHUNK_DELAY_MS` and `MOCK_CHUNK_COUNT` environment variables.

Swap it into your agent:

```python
from agent_server.mock_openai_client import MockAsyncOpenAI
from agents import set_default_openai_client, set_default_openai_api

set_default_openai_client(MockAsyncOpenAI())
set_default_openai_api("chat_completions")
```

The rest of your agent code (handlers, tools, streaming logic) stays unchanged.

#### LangGraph

Replace the `ChatDatabricks` model with a mock that returns pre-built `AIMessage` objects:

```python
# Before:
# model = ChatDatabricks(endpoint="databricks-claude-sonnet-4")

# After:
from agent_server.mock_llm import MockChatModel
model = MockChatModel()
```

The mock should return `AIMessage` objects with tool calls on the first invocation and text content on subsequent invocations, with configurable streaming delays.

#### Custom agents

Wrap whatever external API calls your agent makes (LLM, vector search, tool APIs) with mock implementations that return realistic response shapes with configurable delays.

### Step 3: Set up load testing scripts

Create a `load-test-scripts/` directory in your project. The load testing framework consists of three scripts that are framework-agnostic and work with any Databricks App.

```
<project-root>/
  agent_server/                  # Your existing agent code
  load-test-scripts/             # Load testing scripts (create this)
    run_load_test.py             #   CLI orchestrator
    locustfile.py                #   Locust test with SSE streaming + TTFT tracking
    dashboard_template.py        #   Interactive HTML dashboard generator
  load-test-runs/                # Results (auto-created per run)
    <run-name>/
      dashboard.html             #   Interactive dashboard
      test_config.json           #   Test parameters for reproducibility
      <label>/                   #   Per-config Locust CSV output
```

You can copy the reference implementation from the `app-templates` repository:

```bash
git clone https://github.com/databricks/app-templates.git
cp -r app-templates/agent-load-testing/load-test-scripts/ ./load-test-scripts/
```

Install dependencies:

```bash
uv add locust requests
```

**What each file does:**

- **`locustfile.py`** — A Locust load test that sends `POST /invocations` requests with `stream: true`, parses SSE streams (`data: {json}` lines) and counts chunks until `data: [DONE]`, tracks time to first token (TTFT) as a custom Locust metric, authenticates via U2M (default) or M2M OAuth with auto-refresh, and implements a `StepRampShape` that ramps users from `step_size` to `max_users` while holding each level for `step_duration` seconds.

- **`run_load_test.py`** — A CLI orchestrator that tests each app URL sequentially with isolated metrics per configuration. It handles OAuth token refresh, runs a healthcheck and warmup before each test, saves results to `load-test-runs/<run-name>/<label>/`, and optionally generates a dashboard at the end.

- **`dashboard_template.py`** — Generates a self-contained HTML dashboard using Chart.js. Includes KPI cards, bar charts (QPS, latency, TTFT by config), QPS ramp progression line charts with tabs and a max-users slider, and a full results table. Can be run standalone: `python dashboard_template.py ../load-test-runs/<run-name>/`.

### Step 4: Deploy test apps with varying configurations

Deploy multiple Databricks Apps with different compute sizes and worker counts to find the optimal configuration for your workload.

#### Recommended test matrix

| Compute size | Workers | Suggested app name |
|---|---|---|
| Medium | 2 | `<your-app>-medium-w2` |
| Medium | 3 | `<your-app>-medium-w3` |
| Medium | 4 | `<your-app>-medium-w4` |
| Large | 6 | `<your-app>-large-w6` |
| Large | 8 | `<your-app>-large-w8` |
| Large | 10 | `<your-app>-large-w10` |

#### Configure compute size

Use the Databricks CLI to set compute size when creating or updating an app:

```bash
# Create a new app with Medium compute
databricks apps create <app-name> --compute-size MEDIUM

# Update an existing app to Large compute
databricks apps update <app-name> --compute-size LARGE
```

You can also configure compute size in the Databricks UI under **Compute** > **Apps** > your app > **Edit** > **Configure** > **Compute**.

#### Configure worker count with Databricks Asset Bundles

`start-server` (via `AgentServer.run()`) accepts a `--workers` flag directly. Pass the worker count in the `command` array using a DAB variable — no wrapper script needed:

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
        command: ["uv", "run", "start-server", "--workers", "${var.workers}"]
        env:
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

#### Deploy and verify

Deploy each target with the Databricks CLI:

```bash
databricks bundle deploy --target medium-w4
databricks bundle run load_test_app --target medium-w4
```

Verify that apps are active before running load tests:

```bash
databricks apps get <app-name> --output json | jq '{app_status, compute_status, url}'
```

> **Important:** Wait for all apps to reach `ACTIVE` status before proceeding. Apps that are still starting will produce misleading results.

### Step 5: Run load tests

#### Authentication

The load testing scripts authenticate to your Databricks App automatically:

- **Short tests (under ~1 hour):** Just run `databricks auth login` beforehand. The scripts automatically pick up the U2M token via `databricks auth token`. Set `DATABRICKS_HOST` and `DATABRICKS_PROFILE` so the scripts know which workspace and profile to use:

```bash
export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
export DATABRICKS_PROFILE=<your-profile-name>   # profile from ~/.databrickscfg
```

- **Long tests (over ~1 hour):** U2M tokens can expire mid-run. Use M2M OAuth with a service principal instead:

```bash
export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
export DATABRICKS_CLIENT_ID=<your-client-id>
export DATABRICKS_CLIENT_SECRET=<your-client-secret>
```

#### Parameters reference

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `--app-url` | Yes | — | App URL(s) to test (repeatable) |
| `--client-id` | No | `DATABRICKS_CLIENT_ID` env | Service principal client ID (for long tests) |
| `--client-secret` | No | `DATABRICKS_CLIENT_SECRET` env | Service principal client secret (for long tests) |
| `--label` | No | Auto-derived from URL | Human-readable label per app (repeatable) |
| `--compute-size` | No | Auto-detected or `medium` | Compute size tag per app: `medium`, `large` (repeatable) |
| `--max-users` | No | `300` | Maximum concurrent simulated users |
| `--step-size` | No | `20` | Users added per ramp step |
| `--step-duration` | No | `30` | Seconds per ramp step |
| `--spawn-rate` | No | `20` | User spawn rate (users/sec) |
| `--run-name` | No | `<timestamp>` | Name for this run — results saved to `load-test-runs/<run-name>/` |
| `--dashboard` | No | Off | Generate interactive HTML dashboard after tests complete |

#### Example commands

Quick single-app test (uses U2M auth from `databricks auth login`):

```bash
cd load-test-scripts/

uv run run_load_test.py \
    --app-url https://my-app.aws.databricksapps.com \
    --dashboard --run-name quick-test
```

Full 6-app matrix (approximately 45 minutes with defaults, U2M is fine):

```bash
uv run run_load_test.py \
    --app-url https://my-app-medium-w2.aws.databricksapps.com \
    --app-url https://my-app-medium-w3.aws.databricksapps.com \
    --app-url https://my-app-medium-w4.aws.databricksapps.com \
    --app-url https://my-app-large-w6.aws.databricksapps.com \
    --app-url https://my-app-large-w8.aws.databricksapps.com \
    --app-url https://my-app-large-w10.aws.databricksapps.com \
    --compute-size medium --compute-size medium --compute-size medium \
    --compute-size large --compute-size large --compute-size large \
    --dashboard --run-name full-sweep
```

Overnight high-concurrency test (use M2M OAuth since duration exceeds 1 hour):

```bash
uv run run_load_test.py \
    --app-url https://my-app-medium-w2.aws.databricksapps.com \
    --app-url https://my-app-large-w8.aws.databricksapps.com \
    --compute-size medium --compute-size large \
    --client-id $DATABRICKS_CLIENT_ID \
    --client-secret $DATABRICKS_CLIENT_SECRET \
    --max-users 1000 --step-size 20 --step-duration 10 \
    --dashboard --run-name overnight-sweep
```

Multiple runs for statistical consistency (use M2M if conducting prolonged 1hr+ load testing):

```bash
for RUN in r1 r2 r3 r4 r5; do
  uv run run_load_test.py \
      --app-url https://my-app.aws.databricksapps.com \
      --client-id $DATABRICKS_CLIENT_ID \
      --client-secret $DATABRICKS_CLIENT_SECRET \
      --max-users 1000 --step-size 20 --step-duration 10 \
      --run-name my_test_${RUN} --dashboard || break
done
```

#### What happens during a run

1. **Healthcheck** — verifies the app streams correctly (receives `[DONE]`)
2. **Warmup** — sends sequential requests to warm up the app
3. **Ramp-to-saturation** — steps up concurrent users every `step_duration` seconds
4. **Saturation detection** — when QPS plateaus despite adding users, you've found the throughput ceiling

#### Estimated duration

Duration per app: `(max_users / step_size) * step_duration` seconds.

With defaults (`--max-users 300 --step-size 20 --step-duration 30`):
- 15 steps x 30 seconds = approximately 7.5 minutes per app
- For 6 apps (recommended matrix): approximately 45 minutes — well under the U2M token lifetime

### Step 6: View and interpret results

#### Open the dashboard

```bash
open load-test-runs/<run-name>/dashboard.html
```

#### Regenerate from existing data

If you need to regenerate the dashboard (for example, after updating the template):

```bash
cd load-test-scripts/
python dashboard_template.py ../load-test-runs/<run-name>/
```

#### Dashboard sections

The interactive dashboard includes:

- **KPI cards** — best configuration (by peak successful QPS), overall peak QPS, lowest latency, and total requests served
- **QPS by Config** — grouped bar chart showing median QPS, peak QPS excluding failures, and peak QPS side-by-side for each configuration
- **Latency by Config** — grouped bars showing p50 and p95 latency
- **TTFT by Config** — time to first token (p50 and p95)
- **Total Requests Served** — request count per configuration
- **QPS Ramp Progression** — line charts with tabs for QPS, QPS (excluding failures), Latency, and Failures. Includes a max-users slider to zoom into lower concurrency ranges. Charts are grouped by compute size (medium and large side-by-side).
- **Full Results Table** — all configurations with peak QPS, users at peak, latency percentiles, and failure rate
- **Test Parameters** — configuration summary for reproducibility

#### How to interpret results

- **Peak QPS** — the maximum QPS achieved at any ramp step. This is the throughput ceiling for that configuration.
- **Users at Peak** — the number of concurrent users when peak QPS was achieved. Adding more users beyond this point does not increase throughput.
- **Failure Rate** — should be 0% or very low. A high failure rate means the app is overloaded at that concurrency level.
- **QPS Ramp Chart** — look for where the line flattens. That is the saturation point — the app cannot process requests any faster regardless of additional users.

## Reference results

The following results were measured on Databricks Apps using the mock agent (10ms chunk delay, 80 chunks per response) with the OpenAI Agents SDK template.

| Compute size | Recommended workers | Expected peak QPS |
|---|---|---|
| Medium | 2 | ~155 QPS |
| Large | 8 (safe default in the 6-10 range) | ~280 QPS |

Key findings:

- **Large compute delivers approximately 2.2x the throughput of Medium.**
- **More workers is not always better.** On Medium compute, 2 workers outperforms 8 workers by approximately 40%.
- **Near-zero failure rate** across all configurations, even at 1,000 concurrent users.
- **These numbers represent infrastructure throughput only.** With real LLM calls, your effective QPS will be lower and bounded by the LLM response latency.

> **Note:** Your results will vary based on agent complexity, response size, and workspace configuration. Use these numbers as a baseline for capacity planning.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Auth token expired mid-test | Test is likely over ~1 hour. Use M2M OAuth (`--client-id` / `--client-secret`) for long tests |
| Healthcheck fails | Verify the app is ACTIVE: `databricks apps get <name> --output json` |
| 0 QPS or no results | Check `load-test-runs/<run-name>/<label>/locust_output.log` for errors |
| Low QPS despite high user count | The app is saturated — try more workers or larger compute |
| High failure rate | The app is overloaded — reduce `--max-users` or increase workers/compute |
| Dashboard shows no ramp data | Ensure `results_stats_history.csv` exists in each result subdirectory |

## Next steps

- **Test with real LLM calls** — skip the mocking step and deploy your actual agent to measure end-to-end latency including LLM response time.
- **Tune worker count** — use the test matrix results to find the optimal worker count for your compute size.
- **Evaluate agent quality** — see [Evaluate your agent](/aws/en/generative-ai/agent-framework/agent-evaluation.html) to measure accuracy, relevance, and safety alongside throughput.
