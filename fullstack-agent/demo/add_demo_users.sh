#!/usr/bin/env bash
# Adds the two demo users to the app users group, so they can use the app. Safe to rerun.
set -euo pipefail

BUNDLE_JSON="$(databricks bundle validate ${1:+-t "$1"} -o json)"
TARGET="$(jq -r .bundle.target <<<"$BUNDLE_JSON")"

bundle_variable() {
  jq -r --arg name "$1" '.variables[$name].value' <<<"$BUNDLE_JSON"
}

APP_USERS_GROUP="$(bundle_variable app_users_group)"

user_id() {
  local id
  id="$(databricks users list -o json --attributes id \
    --filter "userName eq \"$1\"" | jq -r '.[0].id // empty')"
  if [[ -z "$id" ]]; then
    echo "No workspace user $1. Add the user to the workspace, or fix the demo user emails in .databricks/bundle/$TARGET/variable-overrides.json." >&2
    exit 1
  fi
  echo "$id"
}

GROUP_ID="$(databricks workspace-iam-v2 list-groups-proxy -o json \
  --filter "group_name eq \"$APP_USERS_GROUP\"" | jq -r '.[0].group_id // empty')"
if [[ -z "$GROUP_ID" ]]; then
  echo "No account group $APP_USERS_GROUP. Run scripts/setup_identities.sh $TARGET, then this script again." >&2
  exit 1
fi

for email in "$(bundle_variable demo_user_one_email)" "$(bundle_variable demo_user_two_email)"; do
  member="$(user_id "$email")"
  if databricks workspace-iam-v2 list-direct-group-members-proxy "$GROUP_ID" -o json \
    | jq -e --arg id "$member" '.[]? | select((.principal_id | tostring) == $id)' >/dev/null; then
    echo "$email is already in $APP_USERS_GROUP"
    continue
  fi
  databricks workspace-iam-v2 create-direct-group-member-proxy "$GROUP_ID" "$member" >/dev/null
  echo "added $email to $APP_USERS_GROUP"
done
