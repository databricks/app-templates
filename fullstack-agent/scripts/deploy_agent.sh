#!/usr/bin/env bash
set -euo pipefail

APP_YAML="app/app.yaml"
AGENT_TOML="app/agent.toml"
PROFILE="${DATABRICKS_CONFIG_PROFILE:-}"

if ! git diff --quiet HEAD -- "$APP_YAML"; then
  echo "$APP_YAML has uncommitted changes. Commit them first: this script restores the committed file after the deploy." >&2
  exit 1
fi

if ! git diff --quiet HEAD -- "$AGENT_TOML"; then
  echo "$AGENT_TOML has uncommitted changes. Commit them first: this script restores the committed file after the deploy." >&2
  exit 1
fi

npm --prefix frontend ci
npm --prefix frontend run build
if [[ -n "$(git status --porcelain -- app/static)" ]]; then
  echo "app/static differs from a fresh build of frontend/src. Commit the rebuilt app/static, then run this script again." >&2
  exit 1
fi

BUNDLE_JSON="$(databricks bundle validate ${1:+-t "$1"} -o json)"
TARGET="$(jq -r .bundle.target <<<"$BUNDLE_JSON")"
SOURCE_PATH="$(jq -r '.workspace.root_path' <<<"$BUNDLE_JSON")/app"

bundle_variable() {
  jq -r --arg name "$1" '.variables[$name].value' <<<"$BUNDLE_JSON"
}

PROJECT="$(bundle_variable project)"
scripts/check_bundle_name.sh "$TARGET"
DEPLOYMENT_NAME="$(sed -n 's/^deployment_name = "\(.*\)"$/\1/p' "$AGENT_TOML")"
SESSION_STORE="$(awk -F'"' '/^\[session_store\]/ { in_store = 1; next } /^\[/ { in_store = 0 } in_store && /^name *=/ { print $2 }' "$AGENT_TOML")"
if [[ "$DEPLOYMENT_NAME" != "$PROJECT" || "$SESSION_STORE" != "$PROJECT-sessions" ]]; then
  echo "$AGENT_TOML names deployment_name \"$DEPLOYMENT_NAME\" and session store \"$SESSION_STORE\", but the bundle's project is \"$PROJECT\". Set them to \"$PROJECT\" and \"$PROJECT-sessions\" and commit, then run this script again: a store shared with another project mixes their conversations." >&2
  exit 1
fi
APP_NAME="$(bundle_variable agent_app_name)"
BUNDLE_SUMMARY="$(databricks bundle summary -t "$TARGET" -o json)"
APP_WAREHOUSE_ID="$(jq -r '.resources.sql_warehouses.app_warehouse.id // empty' <<<"$BUNDLE_SUMMARY")"
TRACE_EXPERIMENT_ID="$(jq -r '.resources.experiments.agent_traces.id // empty' <<<"$BUNDLE_SUMMARY")"
if [[ -z "$APP_WAREHOUSE_ID" || -z "$TRACE_EXPERIMENT_ID" ]]; then
  echo "The app's SQL warehouse or trace experiment is not deployed for target $TARGET. Run databricks bundle deploy -t $TARGET, then this script again." >&2
  exit 1
fi

TELEMETRY_SCHEMA="$(jq -r '.resources.schemas.ops | "\(.catalog_name).\(.name)"' <<<"$BUNDLE_JSON")"
TELEMETRY_PREFIX="$TELEMETRY_SCHEMA.$(bundle_variable app_telemetry_table_prefix)"
TELEMETRY_DESTINATIONS="$(jq -cn --arg prefix "$TELEMETRY_PREFIX" \
  '[{unity_catalog: {logs_table: ($prefix + "_otel_logs"), metrics_table: ($prefix + "_otel_metrics"), traces_table: ($prefix + "_otel_spans")}}]')"

MODEL_NAME="$(bundle_variable project)-$(git rev-parse --short=12 HEAD)$(git diff --quiet HEAD -- . || echo -dirty)"

logged_model_failed() {
  echo "Could not find or create the LoggedModel $MODEL_NAME in experiment $TRACE_EXPERIMENT_ID, so the app was not deployed. Fix the error above, check that you can edit the experiment, then run this script again." >&2
  exit 1
}

MODEL_INFO="$(databricks experiments search-logged-models -o json --json "$(jq -n --arg id "$TRACE_EXPERIMENT_ID" --arg filter "name = '$MODEL_NAME'" \
  '{experiment_ids: [$id], filter: $filter, max_results: 1}')" | jq -c '.models[0].info // empty')" || logged_model_failed
if [[ -z "$MODEL_INFO" ]]; then
  MODEL_INFO="$(databricks experiments create-logged-model "$TRACE_EXPERIMENT_ID" --name "$MODEL_NAME" --model-type Agent -o json | jq -ce .model.info)" || logged_model_failed
fi
MODEL_ID="$(jq -er .model_id <<<"$MODEL_INFO")" || logged_model_failed
if [[ "$(jq -r .status <<<"$MODEL_INFO")" != "LOGGED_MODEL_READY" ]]; then
  databricks experiments finalize-logged-model "$MODEL_ID" LOGGED_MODEL_READY >/dev/null || logged_model_failed
fi
echo "LoggedModel $MODEL_NAME ($MODEL_ID) in experiment $TRACE_EXPERIMENT_ID"

trap 'git checkout -- "$APP_YAML" "$AGENT_TOML"' EXIT
cat >>"$APP_YAML" <<YAML
  - name: APP_CATALOG
    value: "$(bundle_variable catalog)"
  - name: APP_PROJECT
    value: "$(bundle_variable project)"
  - name: APP_VERSION
    value: "$(git describe --always --abbrev=12)$(git diff --quiet HEAD -- . || echo -dirty)"
  - name: APP_ENVIRONMENT
    value: "$TARGET"
  - name: MLFLOW_ACTIVE_MODEL_ID
    value: "$MODEL_ID"
YAML

cat >>"$AGENT_TOML" <<TOML

[tracing]
experiment_name = "$(jq -r '.resources.experiments.agent_traces.name' <<<"$BUNDLE_JSON")"
TOML

PIP_INDEX_URL="$(bundle_variable pip_index_url)"

deploy() {
  if [ -n "$PROFILE" ]; then
    agentbricks -p "$PROFILE" deploy --source app --workspace-path "$SOURCE_PATH" --instances 1 --pip-index-url "$PIP_INDEX_URL"
  else
    agentbricks deploy --source app --workspace-path "$SOURCE_PATH" --instances 1 --pip-index-url "$PIP_INDEX_URL"
  fi
}

add_warehouse_resource() {
  local resources
  resources="$(databricks apps get "$APP_NAME" -o json | jq --arg id "$APP_WAREHOUSE_ID" \
    '[(.resources // [])[] | select(.name != "app_warehouse")] + [{name: "app_warehouse", sql_warehouse: {id: $id, permission: "CAN_USE"}}]')"
  databricks apps create-update "$APP_NAME" --json "$(jq -n --argjson resources "$resources" \
    '{app: {resources: $resources}, update_mask: "resources"}')" >/dev/null
  echo "app $APP_NAME: warehouse $APP_WAREHOUSE_ID is its app_warehouse resource"
}

set_usage_policy() {
  local policy_id
  policy_id="$(bundle_variable app_usage_policy_id)"
  if [[ -n "$policy_id" && "$policy_id" != "null" ]]; then
    databricks apps create-update "$APP_NAME" --json "$(jq -n --arg id "$policy_id" \
      '{app: {usage_policy_id: $id}, update_mask: "usage_policy_id"}')" >/dev/null
    echo "app $APP_NAME: usage_policy_id set to $policy_id"
  fi
}

set_telemetry_export() {
  databricks apps create-update "$APP_NAME" --json "$(jq -n --argjson destinations "$TELEMETRY_DESTINATIONS" \
    '{app: {telemetry_export_destinations: $destinations}, update_mask: "telemetry_export_destinations"}')" >/dev/null
  echo "app $APP_NAME: telemetry export to ${TELEMETRY_PREFIX}_otel_*"
}

check_telemetry_export() {
  local actual
  actual="$(databricks apps get "$APP_NAME" -o json | jq -c '.telemetry_export_destinations // []')"
  if ! jq -en --argjson actual "$actual" --argjson expected "$TELEMETRY_DESTINATIONS" '$actual == $expected' >/dev/null; then
    echo "app $APP_NAME exports telemetry to $actual, expected $TELEMETRY_DESTINATIONS. Run this script again; if it persists, set telemetry_export_destinations in the app's settings." >&2
    exit 1
  fi
  echo "app $APP_NAME: telemetry export checked"
}

if app_error="$(databricks apps get "$APP_NAME" -o json 2>&1 >/dev/null)"; then
  add_warehouse_resource
  set_usage_policy
  set_telemetry_export
  deploy
elif [[ "$app_error" == *"does not exist"* ]]; then
  echo "app $APP_NAME does not exist yet: deploying it, adding its warehouse resource and telemetry export, then deploying again so both take effect"
  deploy
  add_warehouse_resource
  set_usage_policy
  set_telemetry_export
  deploy
else
  echo "Could not read app $APP_NAME: $app_error" >&2
  exit 1
fi

check_telemetry_export
