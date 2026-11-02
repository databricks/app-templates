#!/usr/bin/env bash
set -euo pipefail

BUNDLE_JSON="$(databricks bundle validate ${1:+-t "$1"} -o json)"
TARGET="$(jq -r .bundle.target <<<"$BUNDLE_JSON")"
OVERRIDES=".databricks/bundle/$TARGET/variable-overrides.json"
CREATED_PRINCIPALS=".databricks/bundle/$TARGET/created-service-principals"

bundle_variable() {
  jq -r --arg name "$1" '.variables[$name].value' <<<"$BUNDLE_JSON"
}

CATALOG="$(bundle_variable catalog)"
BACKOFFICE_GROUP="$(bundle_variable backoffice_group)"
APP_USERS_GROUP="$(bundle_variable app_users_group)"
AGENT_APPS_GROUP="$(bundle_variable agent_apps_group)"
OPS_GROUP="$(bundle_variable ops_group)"
EVAL_GROUP="$(bundle_variable eval_group)"
DATA_OWNER_APP_ID="$(bundle_variable data_owner_application_id)"
DATA_OWNER_NAME="$(bundle_variable data_owner_name)"
AGENT_APP="$(bundle_variable agent_app_name)"
TRACE_EXPERIMENT="$(jq -r '.resources.experiments.agent_traces.name' <<<"$BUNDLE_JSON")"
DEPLOYER="$(databricks current-user me -o json | jq -r .userName)"
if [[ "$DEPLOYER" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  DEPLOYER_PRINCIPAL="servicePrincipals/$DEPLOYER"
else
  DEPLOYER_PRINCIPAL="users/$DEPLOYER"
fi

service_principal_id() {
  databricks service-principals list -o json \
    --filter "applicationId eq \"$1\"" | jq -r '.[0].id // empty'
}

service_principal_named() {
  local app_id
  app_id="$(databricks service-principals list -o json --filter "displayName eq \"$1\"" | jq -r '.[0].applicationId // empty')"
  if [[ -z "$app_id" ]]; then
    app_id="$(databricks service-principals create --display-name "$1" -o json | jq -r .applicationId)"
    mkdir -p "$(dirname "$CREATED_PRINCIPALS")"
    echo "$app_id" >>"$CREATED_PRINCIPALS"
    echo "created service principal $1, listed in $CREATED_PRINCIPALS for scripts/destroy.sh" >&2
  fi
  echo "$app_id"
}

set_override() {
  local current='{}'
  [[ -f "$OVERRIDES" ]] && current="$(cat "$OVERRIDES")"
  mkdir -p "$(dirname "$OVERRIDES")"
  jq --arg name "$1" --arg value "$2" '.[$name] = $value' <<<"$current" >"$OVERRIDES"
  BUNDLE_JSON="$(databricks bundle validate -t "$TARGET" -o json)"
  if [[ "$(bundle_variable "$1")" != "$2" ]]; then
    echo "$1 is set outside $OVERRIDES, for example by BUNDLE_VAR_$1. Set it to $2 there, then run this script again." >&2
    exit 1
  fi
  echo "$1 = $2 in $OVERRIDES"
}

ensure_data_owner() {
  if [[ "$DATA_OWNER_APP_ID" == "$DATA_OWNER_NAME" ]]; then
    DATA_OWNER_APP_ID="$(service_principal_named "$DATA_OWNER_NAME")"
    set_override data_owner_application_id "$DATA_OWNER_APP_ID"
  fi
  if [[ -z "$(service_principal_id "$DATA_OWNER_APP_ID")" ]]; then
    echo "No service principal has the application ID in data_owner_application_id ($DATA_OWNER_APP_ID). Clear it to create $DATA_OWNER_NAME, then run this script again." >&2
    exit 1
  fi
  echo "data owner: $DATA_OWNER_APP_ID"
}

ensure_entitlements() {
  local principal="$1"
  shift
  databricks service-principals patch "$principal" --json "$(jq -n '{
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [{op: "add", path: "entitlements", value: [$ARGS.positional[] | {value: .}]}]
  }' --args "$@")" >/dev/null
  echo "entitlements of principal $principal: $*"
}

ensure_service_principal_user_role() {
  local account_id rule_set_name rule_set updated
  account_id="$(databricks workspace-iam-v2 get-service-principal-proxy "$1" -o json | jq -r .account_id)"
  rule_set_name="accounts/$account_id/servicePrincipals/$DATA_OWNER_APP_ID/ruleSets/default"
  rule_set="$(databricks api get "/api/2.0/preview/accounts/access-control/rule-sets?name=$rule_set_name&etag=")"
  if jq -e --arg who "$DEPLOYER_PRINCIPAL" \
    '.grant_rules[]? | select(.role == "roles/servicePrincipal.user") | .principals | index($who)' \
    <<<"$rule_set" >/dev/null; then
    echo "$DEPLOYER already holds servicePrincipal.user"
    return
  fi
  updated="$(jq --arg who "$DEPLOYER_PRINCIPAL" --arg name "$rule_set_name" '{
    name: $name,
    rule_set: {
      name: $name,
      etag: .etag,
      grant_rules: ((.grant_rules // []) + [{role: "roles/servicePrincipal.user", principals: [$who]}])
    }
  }' <<<"$rule_set")"
  databricks api put /api/2.0/preview/accounts/access-control/rule-sets --json "$updated" >/dev/null
  echo "granted servicePrincipal.user to $DEPLOYER"
}

ensure_account_group() {
  local group_id
  group_id="$(databricks workspace-iam-v2 list-groups-proxy -o json \
    --filter "group_name eq \"$1\"" | jq -r '.[0].group_id // empty')"
  if [[ -z "$group_id" ]]; then
    group_id="$(databricks workspace-iam-v2 create-group-proxy --group-name "$1" -o json | jq -r .group_id)"
    echo "created account group $1"
  fi
  echo "$group_id"
}

ensure_consumer_access() {
  local assignment
  if ! assignment="$(databricks workspace-iam-v2 get-workspace-assignment-proxy "$1" -o json 2>&1)"; then
    if [[ "$assignment" != *"is not directly assigned"* ]]; then
      echo "$assignment" >&2
      exit 1
    fi
    databricks workspace-iam-v2 create-workspace-assignment-proxy --json "$(jq -n --argjson id "$1" \
      '{principal_id: $id, entitlements: ["WORKSPACE_CONSUME"]}')" >/dev/null
    echo "group $2 gets Consumer access"
    return
  fi
  if ! jq -e '.entitlements | index("WORKSPACE_CONSUME")' <<<"$assignment" >/dev/null; then
    echo "Group $2 is assigned to the workspace without Consumer access. Give it Consumer access in the workspace settings, then run this script again." >&2
    exit 1
  fi
  echo "group $2 has Consumer access"
}

ensure_group_member() {
  local group_id="$1" principal_id="$2" group_name="$3"
  if databricks workspace-iam-v2 list-direct-group-members-proxy "$group_id" -o json \
    | jq -e --arg id "$principal_id" '.[]? | select((.principal_id | tostring) == $id)' >/dev/null; then
    echo "principal $principal_id is already in $group_name"
    return
  fi
  databricks workspace-iam-v2 create-direct-group-member-proxy "$group_id" "$principal_id" >/dev/null
  echo "added principal $principal_id to $group_name"
}

grant_catalog() {
  local principal="$1"
  shift
  local privileges
  privileges="$(printf '%s\n' "$@" | jq -R . | jq -s .)"
  databricks grants update catalog "$CATALOG" --json "$(jq -n --arg p "$principal" --argjson add "$privileges" \
    '{changes: [{principal: $p, add: $add}]}')" >/dev/null
  echo "catalog $CATALOG: $principal gets $*"
}

grant_app_use() {
  databricks apps update-permissions "$AGENT_APP" --json "$(jq -n --arg kind "$1" --arg name "$2" \
    '{access_control_list: [{($kind): $name, permission_level: "CAN_USE"}]}')" >/dev/null
  echo "app $AGENT_APP: $2 gets CAN_USE"
}

tag_model_service() {
  local service="$1" existing key value
  existing="$(databricks entity-tag-assignments list model-services "$service" -o json)"
  while IFS=$'\t' read -r key value; do
    if jq -e --arg key "$key" --arg value "$value" 'any(.[]; .tag_key == $key and .tag_value == $value)' <<<"$existing" >/dev/null; then
      continue
    fi
    if jq -e --arg key "$key" 'any(.[]; .tag_key == $key)' <<<"$existing" >/dev/null; then
      echo "Model service $service has tag $key with another value. Remove it with databricks entity-tag-assignments delete model-services $service $key, then run this script again." >&2
      exit 1
    fi
    databricks entity-tag-assignments create "$service" "$key" model-services --tag-value "$value" >/dev/null
    echo "model service $service: tag $key=$value"
  done < <(jq -r '.resources.sql_warehouses.app_warehouse.tags.custom_tags[] | [.key, .value] | @tsv' <<<"$BUNDLE_JSON")
}

setup_agent_app() {
  local app_json app_id service
  if ! app_json="$(databricks apps get "$AGENT_APP" -o json 2>/dev/null)"; then
    echo "app $AGENT_APP is not deployed yet: the model service tags and the app's grants wait. Run databricks bundle deploy and scripts/deploy_agent.sh, then this script again."
    return
  fi
  while read -r service; do
    tag_model_service "$service"
  done < <(jq -r '.resources.schemas.ops as $ops | .resources.model_services[] | "\($ops.catalog_name).\($ops.name).\(.model_service_id)"' <<<"$BUNDLE_JSON")
  app_id="$(jq -r .service_principal_client_id <<<"$app_json")"
  grant_catalog "$app_id" USE_CATALOG
  grant_app_use group_name "$APP_USERS_GROUP"
  local test_user
  for test_user in "$(bundle_variable test_user_one_id)" "$(bundle_variable test_user_two_id)"; do
    [[ -n "$test_user" ]] || continue
    grant_app_use service_principal_name "$test_user"
  done
  databricks bundle run -t "$TARGET" app_grants \
    --params "agent_application_id=$app_id" >/dev/null
  echo "app_grants applied for $app_id"
  ensure_group_member "$AGENT_APPS_GROUP_ID" "$(service_principal_id "$app_id")" "$AGENT_APPS_GROUP"
  grant_trace_tables
}

trace_tables() {
  databricks experiments get-by-name "$TRACE_EXPERIMENT" -o json |
    jq -r --arg kinds "$1" '.experiment.tags[] | select(.key | test("^mlflow\\.experiment\\.databricksTrace(" + $kinds + ")StorageTable$")) | .value'
}

app_telemetry_tables() {
  local schema prefix kind table exists
  schema="$(jq -r '.resources.schemas.ops.name' <<<"$BUNDLE_JSON")"
  prefix="$CATALOG.$schema.$(bundle_variable app_telemetry_table_prefix)"
  for kind in annotations logs metrics spans; do
    table="${prefix}_otel_$kind"
    exists="$(databricks tables exists "$table" -o json | jq -r .table_exists)" || exit 1
    if [[ "$exists" == true ]]; then
      echo "$table"
    else
      echo "telemetry table $table does not exist yet: its grants wait. Run scripts/deploy_agent.sh, then this script again." >&2
    fi
  done
}

grant_trace_tables() {
  local readable written telemetry scored table
  if ! databricks experiments get-by-name "$TRACE_EXPERIMENT" >/dev/null 2>&1; then
    echo "trace experiment $TRACE_EXPERIMENT is not deployed yet: the trace table grants wait. Run databricks bundle deploy, then this script again."
    return
  fi
  readable="$(trace_tables "Span|Log|Metric|Annotation|")"
  written="$(trace_tables "Span|Log|Metric|Annotation")"
  if [[ -z "$written" ]]; then
    echo "The trace experiment names no trace tables in its tags. Run databricks bundle deploy, then this script again." >&2
    exit 1
  fi
  telemetry="$(app_telemetry_tables)"
  readable="$readable"$'\n'"$telemetry"
  written="$written"$'\n'"$telemetry"
  for table in $readable; do
    databricks grants update table "$table" --json "$(jq -n --arg group "$OPS_GROUP" \
      '{changes: [{principal: $group, add: ["SELECT"]}]}')" >/dev/null
    echo "trace table $table: $OPS_GROUP gets SELECT"
  done
  for table in $written; do
    databricks grants update table "$table" --json "$(jq -n --arg owner "$DATA_OWNER_APP_ID" \
      '{changes: [{principal: $owner, add: ["SELECT", "MODIFY"]}]}')" >/dev/null
    echo "trace table $table: the data owner gets SELECT and MODIFY"
  done
  scored="$(trace_tables "Span|Annotation|")"
  for table in $scored; do
    databricks grants update table "$table" --json "$(jq -n --arg group "$EVAL_GROUP" \
      '{changes: [{principal: $group, add: ["SELECT"]}]}')" >/dev/null
    echo "trace table $table: $EVAL_GROUP gets SELECT"
  done
  table="$(trace_tables Annotation)"
  databricks grants update table "$table" --json "$(jq -n --arg group "$EVAL_GROUP" \
    '{changes: [{principal: $group, add: ["MODIFY"]}]}')" >/dev/null
  echo "trace table $table: $EVAL_GROUP gets MODIFY for the production scorers' assessments"
}

ensure_test_identity() {
  local name="$1" variable="$2" group_id="$3" group_name="$4" entitlement="$5" app_id principal_id
  [[ -n "$name" ]] || return 0
  app_id="$(bundle_variable "$variable")"
  if [[ -z "$app_id" ]]; then
    app_id="$(service_principal_named "$name")"
    set_override "$variable" "$app_id"
  fi
  principal_id="$(service_principal_id "$app_id")"
  if [[ -z "$principal_id" ]]; then
    echo "No service principal has the application ID in $variable ($app_id). Clear $variable to create $name, then run this script again." >&2
    exit 1
  fi
  ensure_group_member "$group_id" "$principal_id" "$group_name"
  ensure_entitlements "$principal_id" "$entitlement"
}

ensure_data_owner
OWNER_ID="$(service_principal_id "$DATA_OWNER_APP_ID")"
ensure_entitlements "$OWNER_ID" databricks-sql-access workspace-access
ensure_service_principal_user_role "$OWNER_ID"
BACKOFFICE_GROUP_ID="$(ensure_account_group "$BACKOFFICE_GROUP" | tail -n 1)"
ensure_group_member "$BACKOFFICE_GROUP_ID" "$OWNER_ID" "$BACKOFFICE_GROUP"
grant_catalog "$DATA_OWNER_APP_ID" USE_CATALOG
grant_catalog "$DEPLOYER" CREATE_SCHEMA
APP_USERS_GROUP_ID="$(ensure_account_group "$APP_USERS_GROUP" | tail -n 1)"
ensure_consumer_access "$APP_USERS_GROUP_ID" "$APP_USERS_GROUP"
grant_catalog "$APP_USERS_GROUP" USE_CATALOG
OPS_GROUP_ID="$(ensure_account_group "$OPS_GROUP" | tail -n 1)"
ensure_consumer_access "$OPS_GROUP_ID" "$OPS_GROUP"
grant_catalog "$OPS_GROUP" USE_CATALOG
AGENT_APPS_GROUP_ID="$(ensure_account_group "$AGENT_APPS_GROUP" | tail -n 1)"
ensure_consumer_access "$AGENT_APPS_GROUP_ID" "$AGENT_APPS_GROUP"
EVAL_GROUP_ID="$(ensure_account_group "$EVAL_GROUP" | tail -n 1)"
ensure_consumer_access "$EVAL_GROUP_ID" "$EVAL_GROUP"
grant_catalog "$EVAL_GROUP" USE_CATALOG
ensure_test_identity "$(bundle_variable test_user_one_name)" test_user_one_id \
  "$APP_USERS_GROUP_ID" "$APP_USERS_GROUP" workspace-consume
ensure_test_identity "$(bundle_variable test_user_two_name)" test_user_two_id \
  "$APP_USERS_GROUP_ID" "$APP_USERS_GROUP" workspace-consume
ensure_test_identity "$(bundle_variable test_user_eval_name)" test_user_eval_id \
  "$EVAL_GROUP_ID" "$EVAL_GROUP" workspace-access
setup_agent_app
echo "identities ready"
