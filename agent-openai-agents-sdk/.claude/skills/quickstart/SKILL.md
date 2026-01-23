---
name: quickstart
description: "Set up Databricks agent development environment. Use when: (1) First time setup, (2) Configuring Databricks authentication, (3) User says 'quickstart', 'set up', 'authenticate', or 'configure databricks', (4) No .env.local file exists."
---

# Quickstart & Authentication

## Prerequisites

- **uv** (Python package manager)
- **nvm** with Node 20 (for frontend)
- **Databricks CLI v0.283.0+**

Check CLI version:
```bash
databricks -v  # Must be v0.283.0 or above
brew upgrade databricks  # If version is too old
```

## Run Quickstart

```bash
uv run quickstart
```

**Options:**
- `--profile NAME`: Use specified profile (non-interactive)
- `--host URL`: Workspace URL for initial setup
- `-h, --help`: Show help

**Examples:**
```bash
# Interactive (prompts for profile selection)
uv run quickstart

# Non-interactive with existing profile
uv run quickstart --profile DEFAULT

# New workspace setup
uv run quickstart --host https://your-workspace.cloud.databricks.com
```

## What Quickstart Configures

Creates/updates `.env.local` with:
- `DATABRICKS_CONFIG_PROFILE` - Selected CLI profile
- `MLFLOW_TRACKING_URI` - Set to `databricks://<profile-name>` for local auth
- `MLFLOW_EXPERIMENT_ID` - Auto-created experiment ID

## Manual Authentication (Fallback)

If quickstart fails:

```bash
# Create new profile
databricks auth login --host https://your-workspace.cloud.databricks.com

# Verify
databricks auth profiles
```

Then manually create `.env.local`:
```bash
DATABRICKS_CONFIG_PROFILE=DEFAULT
MLFLOW_TRACKING_URI="databricks://DEFAULT"
MLFLOW_EXPERIMENT_ID=<your-experiment-id>
```

## Next Steps

After quickstart completes:
1. Run `uv run discover-tools` to find available workspace resources (see **discover-tools** skill)
2. Run `uv run start-app` to test locally (see **run-locally** skill)
