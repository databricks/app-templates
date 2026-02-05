---
name: quickstart
description: "Set up TypeScript LangChain agent development environment. Use when: (1) First time setup, (2) Configuring Databricks authentication, (3) User says 'quickstart', 'set up', 'authenticate', or 'configure databricks', (4) No .env file exists."
---

# Quickstart & Authentication

## Prerequisites

- **Node.js 18+**
- **npm** (comes with Node.js)
- **Databricks CLI v0.283.0+**

Check CLI version:
```bash
databricks -v  # Must be v0.283.0 or above
brew upgrade databricks  # If version is too old
```

## Run Quickstart

```bash
npm run quickstart
```

This interactive wizard will:
1. Detect existing Databricks CLI authentication
2. Configure model endpoint
3. Create MLflow experiment
4. Set up MCP tools (optional)
5. Install dependencies
6. Create `.env` file

## What Quickstart Configures

Creates/updates `.env` with:
- `DATABRICKS_HOST` - Workspace URL
- `DATABRICKS_TOKEN` - Personal access token
- `DATABRICKS_MODEL` - Model serving endpoint name
- `MLFLOW_TRACKING_URI` - Set to `databricks`
- `MLFLOW_EXPERIMENT_ID` - Auto-created experiment ID
- `ENABLE_SQL_MCP` - SQL MCP tools enabled/disabled

## Manual Authentication (Fallback)

If quickstart fails:

```bash
# Create new profile
databricks auth login --host https://your-workspace.cloud.databricks.com

# Verify
databricks auth profiles
```

Then manually create `.env` (copy from `.env.example`):
```bash
# Databricks Authentication
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=dapi...

# Model Configuration
DATABRICKS_MODEL=databricks-claude-sonnet-4-5
USE_RESPONSES_API=false
TEMPERATURE=0.1
MAX_TOKENS=2000

# MLflow Tracing
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_ID=<your-experiment-id>

# Server Configuration
PORT=8000

# MCP Configuration (Optional)
ENABLE_SQL_MCP=false
```

## TypeScript-Specific Setup

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

## Next Steps

After quickstart completes:
1. Run `npm run dev` to start the development server (see **run-locally** skill)
2. Test the agent with `curl http://localhost:8000/health`
3. Deploy to Databricks with `databricks bundle deploy -t dev` (see **deploy** skill)

## Available Models

Common Databricks foundation models:
- `databricks-claude-sonnet-4-5` (Claude Sonnet 4.5)
- `databricks-gpt-5-2` (GPT-5.2)
- `databricks-meta-llama-3-3-70b-instruct` (Llama 3.3 70B)

Or use your own custom model serving endpoint.

## Troubleshooting

### "Databricks CLI not found"
Install the Databricks CLI:
```bash
brew install databricks
# OR
curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh
```

### "Cannot find experiment"
Create the experiment manually:
```bash
databricks experiments create \
  --experiment-name "/Users/$(databricks current-user me --output json | jq -r .userName)/agent-langchain-ts"
```

### "Module not found" errors
Ensure dependencies are installed:
```bash
npm install
```
