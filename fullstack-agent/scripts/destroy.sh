#!/usr/bin/env bash
set -euo pipefail

BUNDLE_JSON="$(databricks bundle validate ${1:+-t "$1"} -o json)"
TARGET="$(jq -r .bundle.target <<<"$BUNDLE_JSON")"
OVERRIDES=".databricks/bundle/$TARGET/variable-overrides.json"
CREATED_PRINCIPALS=".databricks/bundle/$TARGET/created-service-principals"
AGENTBRICKS=(agentbricks ${DATABRICKS_CONFIG_PROFILE:+-p "$DATABRICKS_CONFIG_PROFILE"})

bundle_variable() {
  jq -r --arg name "$1" '.variables[$name].value' <<<"$BUNDLE_JSON"
}

PROJECT="$(bundle_variable project)"
CATALOG="$(bundle_variable catalog)"
AGENT_APP="$(bundle_variable agent_app_name)"
ROOT_PATH="$(jq -r .workspace.root_path <<<"$BUNDLE_JSON")"
SESSION_STORE="$(awk -F'"' '/^\[session_store\]/ { in_store = 1; next } /^\[/ { in_store = 0 } in_store && /^name *=/ { print $2 }' app/agent.toml)"
ACCOUNT_GROUPS="$(jq -r '[.variables | .backoffice_group, .app_users_group, .ops_group, .agent_apps_group, .eval_group | .value] | join(", ")' <<<"$BUNDLE_JSON")"

if [[ "$(jq -r '.bundle.mode // empty' <<<"$BUNDLE_JSON")" == production ]]; then
  echo "Target $TARGET is in production mode: only its deploy service principal deploys it, so this script never destroys it. Follow docs/deployment.md#decommission by hand, as that service principal." >&2
  exit 1
fi
scripts/check_bundle_name.sh "$TARGET"
PROTECTED="$(jq -r '[.resources | to_entries[] | .key as $type | .value | to_entries[] | select(.value.lifecycle.prevent_destroy == true) | "\($type).\(.key)"] | join(", ")' <<<"$BUNDLE_JSON")"
if [[ -n "$PROTECTED" ]]; then
  echo "These resources have lifecycle.prevent_destroy, so databricks bundle destroy would refuse them: $PROTECTED. For this run, remove prevent_destroy: true from $(grep -rl 'prevent_destroy: true' resources | paste -sd ' ' -), then run this script again." >&2
  exit 1
fi

service_principal_id() {
  databricks service-principals list -o json \
    --filter "applicationId eq \"$1\"" | jq -r '.[0].id // empty'
}

APP_ID=""
if app_json="$(databricks apps get "$AGENT_APP" -o json 2>/dev/null)"; then
  APP_ID="$(jq -r .service_principal_client_id <<<"$app_json")"
fi
SERVICE_PRINCIPALS=()
if [[ -f "$CREATED_PRINCIPALS" ]]; then
  while read -r app_id; do
    SERVICE_PRINCIPALS+=("$app_id")
  done <"$CREATED_PRINCIPALS"
fi
CREATED_VARIABLES=()
for variable in data_owner_application_id test_user_one_id test_user_two_id test_user_eval_id; do
  app_id="$(bundle_variable "$variable")"
  [[ -n "$app_id" && "$app_id" != "$(bundle_variable data_owner_name)" ]] || continue
  if grep -qsxF "$app_id" "$CREATED_PRINCIPALS"; then
    CREATED_VARIABLES+=("$variable")
  else
    echo "keeping service principal $app_id from $variable: $CREATED_PRINCIPALS doesn't list it, so the setup script didn't create it."
  fi
done

grants="$(databricks grants get catalog "$CATALOG" -o json)"
for principal in ${APP_ID:+"$APP_ID"} ${SERVICE_PRINCIPALS[@]+"${SERVICE_PRINCIPALS[@]}"}; do
  privileges="$(jq -c --arg p "$principal" '[.privilege_assignments[]? | select(.principal == $p) | .privileges[]]' <<<"$grants")"
  [[ "$privileges" == "[]" ]] && continue
  databricks grants update catalog "$CATALOG" --json "$(jq -n --arg p "$principal" --argjson remove "$privileges" \
    '{changes: [{principal: $p, remove: $remove}]}')" >/dev/null
  echo "catalog $CATALOG: $principal loses $(jq -r 'join(", ")' <<<"$privileges")"
done

if [[ -n "$APP_ID" ]]; then
  "${AGENTBRICKS[@]}" deployments delete "$AGENT_APP" -y
  echo "deleted app $AGENT_APP and its runtime store"
fi
if "${AGENTBRICKS[@]}" sessions stores get "$SESSION_STORE" >/dev/null 2>&1; then
  "${AGENTBRICKS[@]}" sessions stores delete "$SESSION_STORE" -y
  echo "deleted session store $SESSION_STORE"
fi
if databricks workspace get-status "$ROOT_PATH/app" >/dev/null 2>&1; then
  databricks workspace delete --recursive "$ROOT_PATH/app"
  echo "deleted the app's source in $ROOT_PATH/app"
fi

databricks bundle destroy -t "$TARGET" --auto-approve

for app_id in ${SERVICE_PRINCIPALS[@]+"${SERVICE_PRINCIPALS[@]}"}; do
  principal_id="$(service_principal_id "$app_id")"
  [[ -n "$principal_id" ]] || continue
  databricks workspace-iam-v2 delete-service-principal-proxy "$principal_id"
  echo "deleted service principal $app_id"
done
if [[ -f "$OVERRIDES" ]]; then
  jq 'del(.[$ARGS.positional[]])' --args ${CREATED_VARIABLES[@]+"${CREATED_VARIABLES[@]}"} <"$OVERRIDES" >"$OVERRIDES.tmp"
  mv "$OVERRIDES.tmp" "$OVERRIDES"
fi
rm -f "$CREATED_PRINCIPALS"
echo "kept the account groups $ACCOUNT_GROUPS and their grants: account groups are account-wide, so other targets of $PROJECT or your identity provider may use them. Once none does, revoke their grants on $CATALOG and delete them (docs/deployment.md#decommission)."
echo "$TARGET of $PROJECT is destroyed."
