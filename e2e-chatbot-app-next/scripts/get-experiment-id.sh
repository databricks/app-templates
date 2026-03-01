#!/usr/bin/env bash
# get-experiment-id.sh
#
# Looks up the MLflow experiment name associated with your Databricks agent
# deployment so you can set MLFLOW_EXPERIMENT_ID in app.yaml.
#
# Usage:
#   ./scripts/get-experiment-id.sh --endpoint <serving-endpoint-name>
#   ./scripts/get-experiment-id.sh --tile-id  <agent-bricks-tile-id>
#   ./scripts/get-experiment-id.sh --app      <databricks-app-name>
#
# The experiment name is printed to stdout on success, suitable for:
#   MLFLOW_EXPERIMENT_ID=$(./scripts/get-experiment-id.sh --endpoint my-endpoint)

set -euo pipefail

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Get the MLflow experiment name for your agent deployment.

Options:
  --endpoint <name>   Serving endpoint name (custom agent or Agent Bricks endpoint)
  --tile-id  <id>     Agent Bricks tile ID (visible in the URL when configuring a tile)
  --app      <name>   Databricks App name

Examples:
  $(basename "$0") --endpoint my-agent-endpoint
  $(basename "$0") --tile-id  9f3c2abd-b9c5-4d41-ab69-b6fc50df91d3
  $(basename "$0") --app      db-chatbot-dev-myname

Once you have the experiment name, set it in app.yaml:
  - name: MLFLOW_EXPERIMENT_ID
    valueFrom: experiment

And configure the experiment resource in databricks.yml:
  - name: experiment
    mlflow_experiment:
      name: "<experiment-name>"
      permission: CAN_EDIT
EOF
  exit 1
}

MODE=""
VALUE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint) MODE="endpoint"; VALUE="$2"; shift 2 ;;
    --tile-id)  MODE="tile";     VALUE="$2"; shift 2 ;;
    --app)      MODE="app";      VALUE="$2"; shift 2 ;;
    -h|--help)  usage ;;
    *) echo "❌ Unknown option: $1" >&2; usage ;;
  esac
done

[[ -z "$MODE" ]] && usage

# ---------- dependency checks ----------
for cmd in databricks jq curl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ Required tool not found: $cmd" >&2
    exit 1
  fi
done

# ---------- auth ----------
HOST=$(databricks auth describe --output json 2>/dev/null | jq -r '.details.host // empty')
if [[ -z "$HOST" ]]; then
  echo "❌ Could not determine Databricks host. Run 'databricks auth login' first." >&2
  exit 1
fi

TOKEN=$(databricks auth token --host "$HOST" --output json 2>/dev/null | jq -r '.access_token // empty')
if [[ -z "$TOKEN" ]]; then
  echo "❌ Could not obtain a Databricks token. Run 'databricks auth login' first." >&2
  exit 1
fi

# ---------- lookup ----------
case "$MODE" in

  endpoint)
    echo "🔍 Looking up experiment for serving endpoint: $VALUE" >&2
    ENDPOINT_JSON=$(databricks serving-endpoints get "$VALUE" --output json 2>/dev/null || true)
    if [[ -z "$ENDPOINT_JSON" || "$ENDPOINT_JSON" == "null" ]]; then
      echo "❌ Serving endpoint not found: $VALUE" >&2
      exit 1
    fi

    # Agent-deployed endpoints tag the associated experiment as MONITOR_EXPERIMENT_ID
    EXPERIMENT_ID=$(echo "$ENDPOINT_JSON" \
      | jq -r '(.tags // []) | map(select(.key == "MONITOR_EXPERIMENT_ID")) | .[0].value // empty')

    if [[ -z "$EXPERIMENT_ID" ]]; then
      echo "❌ No MONITOR_EXPERIMENT_ID tag found on endpoint '$VALUE'." >&2
      echo "   This endpoint may not have an associated MLflow experiment." >&2
      echo "   Only custom-code agents and Agent Bricks endpoints emit this tag." >&2
      exit 1
    fi

    # Convert numeric ID to experiment name via MLflow API
    EXP_JSON=$(curl -sf "$HOST/api/2.0/mlflow/experiments/get?experiment_id=$EXPERIMENT_ID" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null || true)
    EXP_NAME=$(echo "$EXP_JSON" | jq -r '.experiment.name // empty')

    if [[ -n "$EXP_NAME" ]]; then
      echo "$EXP_NAME"
    else
      # Fall back to printing the numeric ID if name lookup fails
      echo "$EXPERIMENT_ID"
    fi
    ;;

  tile)
    # Agent Bricks (Knowledge Assistant / Multi-Agent Supervisor)
    # The tile ID is visible in the URL when configuring a tile in the Agent Bricks UI.
    echo "🔍 Looking up experiment for Agent Bricks tile: $VALUE" >&2

    TILE_JSON=$(curl -sf "$HOST/api/2.0/tiles/$VALUE" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null || true)

    if [[ -z "$TILE_JSON" ]]; then
      echo "❌ Failed to reach the Agent Bricks API. Check your host and credentials." >&2
      exit 1
    fi

    API_ERR=$(echo "$TILE_JSON" | jq -r '.message // empty')
    if [[ -n "$API_ERR" ]]; then
      echo "❌ Agent Bricks API error: $API_ERR" >&2
      exit 1
    fi

    EXPERIMENT_ID=$(echo "$TILE_JSON" | jq -r '.mlflow_experiment_id // empty')
    if [[ -z "$EXPERIMENT_ID" ]]; then
      echo "❌ No mlflow_experiment_id found for tile '$VALUE'." >&2
      echo "   Make sure the tile ID is correct (visible in the URL when configuring the tile)." >&2
      exit 1
    fi

    # Convert numeric ID to experiment name
    EXP_JSON=$(curl -sf "$HOST/api/2.0/mlflow/experiments/get?experiment_id=$EXPERIMENT_ID" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null || true)
    EXP_NAME=$(echo "$EXP_JSON" | jq -r '.experiment.name // empty')

    if [[ -n "$EXP_NAME" ]]; then
      echo "$EXP_NAME"
    else
      echo "$EXPERIMENT_ID"
    fi
    ;;

  app)
    echo "🔍 Looking up experiment resource for Databricks App: $VALUE" >&2
    APP_JSON=$(databricks apps get "$VALUE" --output json 2>/dev/null || true)
    if [[ -z "$APP_JSON" || "$APP_JSON" == "null" ]]; then
      echo "❌ App not found: $VALUE" >&2
      exit 1
    fi

    EXPERIMENT_ID=$(echo "$APP_JSON" \
      | jq -r '(.resources // []) | map(select(.experiment != null)) | .[0].experiment.experiment_id // empty')

    if [[ -z "$EXPERIMENT_ID" ]]; then
      echo "❌ No MLflow experiment resource found on app '$VALUE'." >&2
      echo "   Configure an experiment resource in databricks.yml and redeploy." >&2
      exit 1
    fi

    # Resolve numeric ID to experiment name
    EXP_JSON=$(curl -sf "$HOST/api/2.0/mlflow/experiments/get?experiment_id=$EXPERIMENT_ID" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null || true)
    EXP_NAME=$(echo "$EXP_JSON" | jq -r '.experiment.name // empty')

    if [[ -n "$EXP_NAME" ]]; then
      echo "$EXP_NAME"
    else
      echo "$EXPERIMENT_ID"
    fi
    ;;

esac
