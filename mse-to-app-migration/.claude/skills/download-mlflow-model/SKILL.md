---
name: download-mlflow-model
description: "Download MLflow model artifacts from Databricks Model Serving. Use when: (1) User wants to migrate from Model Serving to Apps, (2) User needs to download model artifacts, (3) User provides an endpoint name or model URI, (4) Starting the MSE to Apps migration."
---

## Overview

This skill sets up a virtual environment with MLflow and downloads model artifacts from Databricks Model Serving. This is typically the first step when migrating an agent from Model Serving to Databricks Apps.

## Prerequisites

- Databricks CLI installed
- Python 3.10+ installed
- User must provide either:
  - A serving endpoint name, OR
  - A model URI (e.g., `models:/my-model/1`)

## Step-by-Step Process

### 0. Verify Databricks Authentication

**Before anything else**, verify the user has valid authentication to the correct workspace.

#### 0.1 List Available Profiles

```bash
databricks auth profiles
```

#### 0.2 Ask User to Select Profile

Show the user their available profiles and ask which one to use:

> "Which Databricks profile should I use for this migration? Here are your configured profiles:
> [list profiles from output above]
>
> Enter the profile name (or press Enter for DEFAULT):"

#### 0.3 Validate the Selected Profile

```bash
databricks current-user me --profile <selected-profile>
```

If this fails, prompt the user to authenticate:

```bash
databricks auth login --profile <selected-profile>
```

#### 0.4 Remember the Profile

Use `--profile <selected-profile>` on ALL subsequent `databricks` CLI commands, or set:

```bash
export DATABRICKS_CONFIG_PROFILE=<selected-profile>
```

---

### 1. Set Up the Migration Environment

Create and activate a virtual environment with the required dependencies:

```bash
# Create virtual environment
python3 -m venv .migration-venv

# Activate it
source .migration-venv/bin/activate

# Install dependencies (includes boto3 for S3/Unity Catalog access)
pip install -r .claude/skills/download-mlflow-model/migration-requirements.txt
```

### 2. Get Model Info from Endpoint (if starting from endpoint name)

If you have a serving endpoint name, first extract the model details:

```bash
# Get endpoint info (remember to include --profile if using non-default)
databricks serving-endpoints get <endpoint-name> --profile <profile> --output json
```

Look for `served_entities[0].entity_name` (model name) and `entity_version` in the response. Find the entity with 100% traffic in `traffic_config.routes`.

### 3. Download Model Artifacts

Use MLflow Python to download the artifacts:

```python
import mlflow
import os

# Set profile for authentication (if using non-default profile)
os.environ["DATABRICKS_CONFIG_PROFILE"] = "<selected-profile>"

# Set the Databricks tracking URI
mlflow.set_tracking_uri("databricks")

# Download artifacts
mlflow.artifacts.download_artifacts(
    artifact_uri="models:/<model-name>/<version>",
    dst_path="./original_model"
)
```

Run this as a script:

```bash
python3 << 'EOF'
import mlflow
import os

# Set profile for authentication (change if using non-default profile)
os.environ["DATABRICKS_CONFIG_PROFILE"] = "<selected-profile>"

# Configure MLflow for Databricks
mlflow.set_tracking_uri("databricks")

# Replace with actual values from step 2
MODEL_NAME = "<model-name>"
VERSION = "<version>"

print(f"Downloading model: models:/{MODEL_NAME}/{VERSION}")
mlflow.artifacts.download_artifacts(
    artifact_uri=f"models:/{MODEL_NAME}/{VERSION}",
    dst_path="./original_model"
)
print("Download complete! Artifacts saved to ./original_model")
EOF
```

### 4. Verify Downloaded Artifacts

Check that the key files exist:

```bash
# List downloaded files
ls -la ./original_model/

# The agent code is typically in one of these locations:
ls ./original_model/code/agent.py 2>/dev/null || ls ./original_model/agent.py 2>/dev/null

# Check for MLmodel file (contains resource requirements)
cat ./original_model/MLmodel

# Check for input example (useful for testing)
cat ./original_model/input_example.json 2>/dev/null
```

### 5. Deactivate Virtual Environment

After downloading, you can deactivate the migration environment:

```bash
deactivate
```

## Expected Output Structure

After successful download, you should have:

```
./original_model/
├── MLmodel              # Model metadata and resource requirements
├── code/
│   └── agent.py         # Main agent implementation
├── input_example.json   # Sample request for testing
├── requirements.txt     # Original dependencies
└── ...
```

## Key Files to Examine

1. **`agent.py`** - Contains the `ResponsesAgent` class with `predict()` and `predict_stream()` methods
2. **`MLmodel`** - Contains the `resources` section listing required Databricks resources
3. **`input_example.json`** - Use this to test the migrated agent

## Troubleshooting

### "ModuleNotFoundError: No module named 'mlflow'"
Ensure you've activated the virtual environment and installed requirements:
```bash
source .migration-venv/bin/activate
pip install -r .claude/skills/download-mlflow-model/migration-requirements.txt
```

### "Unable to import necessary dependencies to access model version files in Unity Catalog"
This means boto3 is missing. The migration-requirements.txt uses `mlflow[databricks]` which includes boto3, but if you installed manually:
```bash
pip install mlflow[databricks]
# or
pip install boto3
```

### "INVALID_PARAMETER_VALUE" or authentication errors
Re-authenticate with Databricks (include profile if non-default):
```bash
databricks auth login --profile <profile>
```

### Wrong workspace / Model not found
Make sure you're using the correct profile that corresponds to the workspace where the model is deployed:
```bash
# List profiles to see which workspace each points to
databricks auth profiles

# Verify you can access the workspace
databricks current-user me --profile <profile>

# List models in that workspace
databricks registered-models list --profile <profile>
databricks model-versions list --name "<model-name>" --profile <profile>
```

## Next Steps

After downloading the model artifacts:
1. Examine the original `agent.py` to understand the agent's logic
2. Check `MLmodel` for resource requirements
3. Choose an appropriate app template based on the agent's features
4. Continue with the migration following AGENTS.md
