---
name: quickstart
description: "Set up the Databricks chatbot app for local development and deployment. Use when: (1) First time setup, (2) User says 'quickstart', 'set up', 'authenticate', or 'configure databricks', (3) No .env file exists, (4) User says 'enable feedback', 'feedback widget', or 'MLFLOW_EXPERIMENT_ID'."
---

# Quickstart: Databricks Chatbot App

Run the interactive setup script from the `e2e-chatbot-app-next/` directory:

```bash
./scripts/quickstart.sh
```

## What It Configures

The script walks through the following steps interactively:

1. **Prerequisites** — installs jq, nvm, Node 20, and the Databricks CLI if missing
2. **Databricks auth** — lets you select an existing profile or create a new one via `databricks auth login`
3. **Model service** — prompts for your Unity Catalog model service name (3-part UC name) and writes it to `.env`
4. **Feedback widget** — the script cannot auto-detect a linked MLflow experiment for a model service, so it tells you to set `MLFLOW_EXPERIMENT_ID` manually (see [Enabling Feedback After Initial Setup](#enabling-feedback-after-initial-setup) below)
5. **App/bundle name** — optionally customize the app name (default: `db-chatbot-dev-<username>`, max 30 chars)
6. **Database** — optionally enable persistent chat history via a Lakebase instance (~5-10 min, costs apply)
7. **Deploy** — runs `databricks bundle deploy` and starts the app

## Enabling Feedback After Initial Setup

If you skipped feedback during quickstart, or ran the script before feedback support was added, enable it manually:

**1. Find your MLflow experiment ID** — find or create the experiment you want to link (e.g. in the MLflow Experiment Tracking UI) and note its experiment ID.

**2. Set `MLFLOW_EXPERIMENT_ID` in `.env`** (for local dev):
```
MLFLOW_EXPERIMENT_ID=<your-experiment-id>
```

**3. Configure `databricks.yml`** — uncomment and fill in the experiment resource:
```yaml
        - name: experiment
          description: "MLflow experiment for collecting user feedback"
          experiment:
            experiment_id: "<your-experiment-id>"
            permission: CAN_EDIT
```

**4. Configure `app.yaml`** — uncomment the env var:
```yaml
      - name: MLFLOW_EXPERIMENT_ID
        valueFrom: experiment
```

**5. Redeploy:**
```bash
databricks bundle deploy
databricks bundle run databricks_chatbot
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Feedback widget not showing after setup | Restart dev server; env vars are read at startup |
| Feedback submission returns 403 | App service principal is missing `CAN_EDIT` on the experiment — check `permission: CAN_EDIT` in `databricks.yml` |
| "Instance name is not unique" on deploy | Run `./scripts/cleanup-database.sh` to remove the old database instance |
