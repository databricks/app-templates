---
name: enable-feedback
description: "Enable the thumbs up/down feedback widget in the chatbot app by configuring an MLflow experiment. Use when: (1) User says 'enable feedback', 'thumbs up/down', 'feedback widget', or 'MLFLOW_EXPERIMENT_ID', (2) Feedback is disabled and user wants to turn it on, (3) User asks how to connect feedback to their agent."
---

# Enable Feedback in the Chatbot App

The feedback widget (thumbs up/down on messages) is enabled by setting `MLFLOW_EXPERIMENT_ID` to the MLflow experiment associated with your agent. Feedback is stored as trace assessments in that experiment.

## Step 1: Find Your Experiment Name

Use the helper script to look up the correct experiment name. The right flag depends on your agent type:

**Custom code agent or Agent Bricks endpoint** (most common):
```bash
./scripts/get-experiment-id.sh --endpoint <your-serving-endpoint-name>
```

**Agent Bricks tile** (Knowledge Assistant or Multi-Agent Supervisor):
```bash
# The tile ID is the UUID in the URL when configuring the tile in the Agent Bricks UI
./scripts/get-experiment-id.sh --tile-id <tile-uuid>
```

**Databricks App** (if you already have a deployed app with an experiment resource):
```bash
./scripts/get-experiment-id.sh --app <app-name>
```

The script prints the experiment name to stdout on success, e.g.:
```
/Users/you@company.com/my-agent-experiment
```

If it fails, check the error message — common issues:
- `No MONITOR_EXPERIMENT_ID tag` — the endpoint doesn't have a linked experiment (e.g. a Foundation Model endpoint). Feedback is not available for this agent type.
- `App not found` — double-check the app name with `databricks apps list`.

## Step 2: Configure for Deployed Apps (`databricks.yml` + `app.yaml`)

**In `databricks.yml`**, uncomment the experiment resource block and set the experiment name:

```yaml
resources:
  apps:
    databricks_chatbot:
      resources:
        # ... existing serving-endpoint resource ...

        - name: experiment
          description: "MLflow experiment for collecting user feedback"
          mlflow_experiment:
            name: "/Users/you@company.com/your-experiment-name"
            permission: CAN_READ
```

**In `app.yaml`**, uncomment the `MLFLOW_EXPERIMENT_ID` env var:

```yaml
env:
  - name: DATABRICKS_SERVING_ENDPOINT
    valueFrom: serving-endpoint
  - name: MLFLOW_EXPERIMENT_ID
    valueFrom: experiment
```

Then deploy:
```bash
databricks bundle deploy
databricks bundle run databricks_chatbot
```

## Step 3: Configure for Local Development (`.env`)

Add the experiment name directly to your `.env` file:

```bash
MLFLOW_EXPERIMENT_ID=/Users/you@company.com/your-experiment-name
```

The feedback widget will appear automatically once this variable is set. You can verify it's enabled by checking:
```bash
curl http://localhost:3001/api/config
# Should return: {"features":{"chatHistory":...,"feedback":true}}
```

## How It Works

- When `MLFLOW_EXPERIMENT_ID` is set, the server reports `features.feedback: true` from `/api/config`
- The client reads this flag and shows thumbs up/down buttons on assistant messages
- When the user clicks a button, feedback is submitted as an MLflow trace assessment on the experiment
- When `MLFLOW_EXPERIMENT_ID` is not set, the feedback buttons are hidden and a "Feedback disabled" badge appears in the header

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Feedback disabled" badge still shows after setting `MLFLOW_EXPERIMENT_ID` | Restart the dev server; the env var is read at startup |
| Feedback submission returns 403 | The app service principal doesn't have `CAN_READ` on the experiment — check `permission: CAN_READ` in `databricks.yml` |
| `get-experiment-id.sh` fails with auth error | Run `databricks auth login` first |
| No experiment found for endpoint | Only custom-code agents and Agent Bricks endpoints have linked experiments; Foundation Model endpoints do not |
