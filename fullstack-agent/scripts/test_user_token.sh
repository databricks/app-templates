#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  one | two | eval) WHO="$1" ;;
  *)
    echo "Usage: $0 one|two|eval. Prints an M2M token for that test user, or for the eval runner (eval); nothing else goes to stdout." >&2
    exit 1
    ;;
esac

BUNDLE_JSON="$(databricks bundle validate -o json)"
APP_ID="$(jq -r --arg name "test_user_${WHO}_id" '.variables[$name].value // empty' <<<"$BUNDLE_JSON")"
if [[ -z "$APP_ID" ]]; then
  echo "test_user_${WHO}_id is not set. Run scripts/setup_identities.sh, which writes it to the bundle overrides, then run this again." >&2
  exit 1
fi
HOST="$(databricks auth describe -o json | jq -r '.details.host')"
SCIM_ID="$(databricks service-principals list -o json --filter "applicationId eq \"$APP_ID\"" | jq -r '.[0].id // empty')"
if [[ -z "$SCIM_ID" ]]; then
  echo "No service principal has application ID $APP_ID. Run scripts/setup_identities.sh, then this again." >&2
  exit 1
fi

SECRET_JSON="$(databricks service-principal-secrets-proxy create "$SCIM_ID" --lifetime 3600s -o json)"
SECRET_ID="$(jq -r '.id' <<<"$SECRET_JSON")"

delete_secret() {
  if ! databricks service-principal-secrets-proxy delete "$SCIM_ID" "$SECRET_ID" >/dev/null; then
    echo "Could not delete secret $SECRET_ID of $APP_ID. It expires within the hour; delete it with: databricks service-principal-secrets-proxy delete $SCIM_ID $SECRET_ID" >&2
    exit 1
  fi
}
trap delete_secret EXIT

printf 'user = "%s:%s"\n' "$APP_ID" "$(jq -r '.secret' <<<"$SECRET_JSON")" |
  curl --silent --show-error --fail-with-body --config - "$HOST/oidc/v1/token" \
    --data grant_type=client_credentials --data scope=all-apis |
  jq -er '.access_token'
