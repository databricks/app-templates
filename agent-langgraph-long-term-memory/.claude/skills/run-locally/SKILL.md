---
name: run-locally
description: "Run and test the agent locally. Use when: (1) User says 'run locally', 'start server', 'test agent', or 'localhost', (2) Need curl commands to test API, (3) Troubleshooting local development issues, (4) Configuring server options like port or hot-reload."
---

# Run Agent Locally

## Start the Server

```bash
uv run start-app
```

This starts the agent at http://localhost:8000 with both the API server and chat UI.

## Server Options

| Option | Command | When to Use |
|--------|---------|-------------|
| **Hot-reload** | `uv run start-server --reload` | During development - auto-restarts on code changes |
| **Custom port** | `uv run start-server --port 8001` | When port 8000 is in use |
| **Multiple workers** | `uv run start-server --workers 4` | Load testing or production-like simulation |
| **Combined** | `uv run start-server --reload --port 8001` | Development on alternate port |

## Test the API

The agent implements the [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses) interface via MLflow's ResponsesAgent.

**Streaming request:**
```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
```

**Non-streaming request:**
```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

**Request with user_id (for long-term memory):**
```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
      "input": [{"role": "user", "content": "What do you remember about me?"}],
      "custom_inputs": {"user_id": "user@example.com"}
  }'
```

See the **agent-memory** skill for more memory-related request examples.

## Run Evaluation

Evaluate your agent using MLflow scorers:

```bash
uv run agent-evaluate
```

**What it does:**
- Runs the agent against a test dataset
- Applies MLflow scorers (RelevanceToQuery, Safety)
- Records results to your MLflow experiment

**Customize evaluation:**
Edit `agent_server/evaluate_agent.py` to:
- Change the evaluation dataset
- Add or modify scorers
- Adjust evaluation parameters

After evaluation completes, open the MLflow UI link for your experiment to inspect results.

## Run Unit Tests

```bash
pytest [path]
```

## Adding Dependencies

```bash
uv add <package_name>
# Example: uv add "langchain-community"
```

Dependencies are managed in `pyproject.toml`.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Port already in use** | Use `--port 8001` or kill existing process |
| **Authentication errors** | Verify `.env.local` is correct; run **quickstart** skill |
| **Module not found** | Run `uv sync` to install dependencies |
| **MLflow experiment not found** | Ensure `MLFLOW_TRACKING_URI` in `.env.local` is `databricks://<profile-name>` |
| **Lakebase connection errors** | Verify `LAKEBASE_INSTANCE_NAME` in `.env.local`; see **lakebase-setup** skill |

### MLflow Experiment Not Found

If you see: "The provided MLFLOW_EXPERIMENT_ID environment variable value does not exist"

**Verify the experiment exists:**
```bash
databricks -p <profile> experiments get-experiment <experiment_id>
```

**Fix:** Ensure `.env.local` has the correct tracking URI format:
```bash
MLFLOW_TRACKING_URI="databricks://DEFAULT"  # Include profile name
```

The quickstart script configures this automatically. If you manually edited `.env.local`, ensure the profile name is included.

## MLflow Tracing

This template uses MLflow for automatic tracing:
- Agent logic decorated with `@invoke()` and `@stream()` is automatically traced
- LLM invocations are captured via MLflow autologging

To add custom trace instrumentation, see: [MLflow tracing documentation](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/app-instrumentation/)

## Next Steps

- Configure Lakebase: see **lakebase-setup** skill
- Understand memory patterns: see **agent-memory** skill
- Modify your agent: see **modify-agent** skill
- Deploy to Databricks: see **deploy** skill
