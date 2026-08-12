# LangChain TypeScript Agent with MLflow Tracing

A standalone Express and LangChain agent template for Databricks Apps. It uses
`@mlflow/core@0.3.0` as its tracing provider and stores traces in a pre-provisioned
Unity Catalog trace location.

## What is included

- A LangGraph ReAct agent backed by `ChatDatabricks`
- Built-in tools and optional MCP tools
- `/invocations` and `/responses` endpoints with streaming and non-streaming responses
- One semantic `AGENT` trace root per request
- Child spans for every LangChain model, chain, tool, and retriever lifecycle
- Exact token/cache aggregation, latency, time to first token, stream duration, and
  provider cost when the provider returns one
- Bounded, redacted inputs, outputs, events, identities, and errors
- The actual MLflow V4 trace ID in `X-MLflow-Trace-Id` for every successful request;
  non-streaming responses also include `trace_id`

## Prerequisites

- Node.js 22 or later
- `uv`
- Databricks CLI authentication
- A SQL warehouse that can provision the MLflow Unity Catalog trace tables

## Quickstart

From this directory, run:

```bash
npm run quickstart
```

The TypeScript wizard configures authentication and the model, then invokes the shared
Task 10 Python quickstart. That workflow provisions or reuses an experiment through the
supported Python MLflow API:

```python
mlflow.set_experiment(
    experiment_name=experiment_name,
    trace_location=UnityCatalog(
        catalog_name=catalog,
        schema_name=schema,
        table_prefix=table_prefix,
    ),
)
```

It validates the experiment's immutable trace location, provisions the UC tables, applies
app-principal grants when the app already exists, and writes the complete tracing config to
`.env`, `app.yaml`, and `databricks.yml`. It does not call private trace-location endpoints.

Defaults are:

```env
MLFLOW_TRACKING_URI=databricks
MLFLOW_UC_CATALOG=main
MLFLOW_UC_SCHEMA=agent_traces
MLFLOW_UC_TABLE_PREFIX=agents_on_apps
```

Set `MLFLOW_TRACING_SQL_WAREHOUSE_ID` before quickstart to select a warehouse
non-interactively. Set `MLFLOW_EXPERIMENT_NAME` to choose a custom experiment name.

## Required runtime configuration

The server validates these values before it listens:

| Variable | Purpose |
|---|---|
| `MLFLOW_EXPERIMENT_ID` | UC-backed MLflow experiment ID |
| `MLFLOW_UC_CATALOG` | UC catalog containing trace tables |
| `MLFLOW_UC_SCHEMA` | UC schema containing trace tables |
| `MLFLOW_UC_TABLE_PREFIX` | Prefix used for the trace tables |

`MLFLOW_TRACKING_URI` defaults to `databricks`. Deployment also carries
`MLFLOW_TRACING_SQL_WAREHOUSE_ID` and `MLFLOW_OTEL_SPANS_TABLE` for provisioning and
verification.

Missing or malformed required configuration is a startup error. Runtime export failures are
logged and do not change an otherwise successful agent response.

## Run locally

```bash
npm install
npm run dev:agent
```

The agent listens at `http://localhost:5001` in local development.

Streaming request:

```bash
curl -i http://localhost:5001/invocations \
  -H 'Content-Type: application/json' \
  -H 'X-Session-Id: example-session' \
  -H 'X-User-Id: example-user' \
  -H 'X-Request-Id: example-request' \
  -d '{"input":[{"role":"user","content":"What time is it in Tokyo?"}],"stream":true}'
```

The response header contains a V4 identifier such as:

```text
X-MLflow-Trace-Id: trace:/main.agent_traces.agents_on_apps/<32-hex-id>
```

## Trace contract

The request root is named `langchain.request` and has span type `AGENT`. Request headers are
mapped to MLflow metadata:

| Header | Trace metadata |
|---|---|
| `X-Session-Id` | `mlflow.trace.session` |
| `X-User-Id` | `mlflow.trace.user` |
| `X-Request-Id` | `appkit.request.id` |

`appkit.app.name` comes from `DATABRICKS_APP_NAME`, or defaults to
`agent-langchain-ts`. Missing identity headers receive safe request-scoped defaults.

Each LangChain start event creates one live child span keyed by `run_id`; its matching end or
error event finalizes that same span. Model spans record model/provider, exact input/output
and cache tokens, latency, time to first token, stream duration, finish reason, and cost.
When cost is unavailable, the span/root records `costAvailable=false` and omits `costUsd`.

## Test and build

Focused tracing and endpoint tests:

```bash
npm test -- --runInBand tests/framework/tracing.test.ts tests/framework/endpoints.test.ts
```

Build:

```bash
npm run build
```

Deployed test:

```bash
APP_URL=https://your-app.databricksapps.com \
  npm run test:e2e -- --runInBand tests/e2e/deployed.test.ts
```

When `APP_URL` is absent, the deployed suite is collected and skipped. When present, it
invokes the app, checks the returned V4 trace ID, retrieves that trace through
`@mlflow/core`, and verifies the single `AGENT` root has inputs and outputs.

## Deploy

```bash
npm run build
databricks bundle deploy -t dev
databricks bundle run agent_langchain_ts -t dev
```

If quickstart ran before the app existed, rerun it with the deployed app name so the shared
workflow can apply explicit UC grants:

```bash
MLFLOW_EXPERIMENT_NAME=/Users/you@example.com/agents-on-apps npm run quickstart
```

## Customize

- Edit `src/agent.ts` to change the model, prompt, or agent behavior.
- Edit `src/tools.ts` to add tools.
- Edit `src/mcp-servers.ts` to configure Databricks MCP integrations.
- Keep tracing and HTTP lifecycle changes under `src/framework/` covered by framework tests.
