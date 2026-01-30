---
name: download-mlflow-model
description: "Download MLflow model artifacts from Databricks Model Serving. Use when: (1) User wants to migrate from Model Serving to Apps, (2) User needs to download model artifacts, (3) User provides an endpoint name or model URI, (4) Starting the MSE to Apps migration."
---

## Overview

This skill sets up a virtual environment with MLflow and downloads model artifacts from Databricks Model Serving. This is typically the first step when migrating an agent from Model Serving to Databricks Apps.

## Prerequisites

- Databricks CLI authenticated (`databricks auth login`)
- Python 3.10+ installed
- User must provide either:
  - A serving endpoint name, OR
  - A model URI (e.g., `models:/my-model/1`)

## Step-by-Step Process

### 1. Set Up the Migration Environment

Create and activate a virtual environment with the required dependencies:

```bash
# Create virtual environment
python3 -m venv .migration-venv

# Activate it
source .migration-venv/bin/activate

# Install dependencies from migration-requirements.txt
pip install -r migration-requirements.txt
```

### 2. Get Model Info from Endpoint (if starting from endpoint name)

If you have a serving endpoint name, first extract the model details:

```bash
# Get endpoint info
databricks serving-endpoints get <endpoint-name> --output json
```

Look for `served_entities[0].entity_name` (model name) and `entity_version` in the response.

### 3. Download Model Artifacts

Use MLflow Python to download the artifacts:

```python
import mlflow

# Set the Databricks tracking URI (uses DATABRICKS_HOST from environment)
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
import sys

# Configure MLflow for Databricks
mlflow.set_tracking_uri("databricks")

# Replace with actual values
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
pip install -r migration-requirements.txt
```

### "INVALID_PARAMETER_VALUE" or authentication errors
Re-authenticate with Databricks:
```bash
databricks auth login
```

### Model not found
Verify the model name and version exist:
```bash
databricks registered-models list
databricks model-versions list --name "<model-name>"
```

## Next Steps

After downloading the model artifacts:
1. Examine the original `agent.py` to understand the agent's logic
2. Check `MLmodel` for resource requirements
3. Choose an appropriate app template based on the agent's features
4. Continue with the migration following AGENTS.md
