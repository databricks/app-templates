#!/usr/bin/env bash
# Writes app/.env for a local run from the bundle and app/agent.toml, which own its values: agentbricks reads no bundle values and binds no store locally.
# Delete this script once an agentbricks release reads bundle values.
set -euo pipefail

ENV_FILE="app/.env"
PROFILE="${DATABRICKS_CONFIG_PROFILE:?Export DATABRICKS_CONFIG_PROFILE, the profile of the target workspace, then run this script again.}"
BUNDLE_JSON="$(databricks bundle validate ${1:+-t "$1"} -o json)"
TARGET="$(jq -r .bundle.target <<<"$BUNDLE_JSON")"
PROJECT="$(jq -r .variables.project.value <<<"$BUNDLE_JSON")"
STORE="$(grep -A1 '^\[session_store\]' app/agent.toml | sed -n 's/^name = "\(.*\)"$/\1/p')"
WAREHOUSE_ID="$(databricks bundle summary -t "$TARGET" -o json | jq -r '.resources.sql_warehouses.app_warehouse.id // empty')"

if [[ "$STORE" != "$PROJECT-sessions" ]]; then
  echo "app/agent.toml names session store \"$STORE\", but the bundle's project is \"$PROJECT\". Set it to \"$PROJECT-sessions\", then run this script again." >&2
  exit 1
fi
if [[ -z "$WAREHOUSE_ID" ]]; then
  echo "The app's SQL warehouse is not deployed for target $TARGET. Run databricks bundle deploy -t $TARGET, then this script again." >&2
  exit 1
fi

BASE="$ENV_FILE"
[[ -f "$BASE" ]] || BASE="app/.env.example"
KEPT="$(sed -E '/^(DATABRICKS_CONFIG_PROFILE|APP_CATALOG|APP_PROJECT|APP_WAREHOUSE_ID|AGENT_SESSION_STORE)=/d' "$BASE")"
cat >"$ENV_FILE" <<ENV
$KEPT
DATABRICKS_CONFIG_PROFILE=$PROFILE
APP_CATALOG=$(jq -r .variables.catalog.value <<<"$BUNDLE_JSON")
APP_PROJECT=$PROJECT
APP_WAREHOUSE_ID=$WAREHOUSE_ID
AGENT_SESSION_STORE=$STORE
ENV
echo "wrote $ENV_FILE for target $TARGET"
