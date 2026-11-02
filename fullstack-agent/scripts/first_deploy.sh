#!/usr/bin/env bash
set -euo pipefail

for tool in databricks jq npm agentbricks; do
  if ! command -v "$tool" >/dev/null; then
    echo "$tool is not on PATH. Install the prerequisites in README.md, then run this script again." >&2
    exit 1
  fi
done
AGENTBRICKS_PIN="$(sed -n 's/^ *"databricks-agentbricks\[openai\]==\(.*\)",$/\1/p' app/pyproject.toml)"
AGENTBRICKS_VERSION="$(agentbricks --version | awk '{print $NF}')"
if [[ "$AGENTBRICKS_VERSION" != "$AGENTBRICKS_PIN" ]]; then
  echo "agentbricks is \"$AGENTBRICKS_VERSION\", but app/pyproject.toml pins databricks-agentbricks[openai]==\"$AGENTBRICKS_PIN\". Run uv tool install databricks-agentbricks==$AGENTBRICKS_PIN, then this script again." >&2
  exit 1
fi

BUNDLE_JSON="$(databricks bundle validate ${1:+-t "$1"} -o json)"
TARGET="$(jq -r .bundle.target <<<"$BUNDLE_JSON")"
OVERRIDES=".databricks/bundle/$TARGET/variable-overrides.json"
CATALOG="$(jq -r .variables.catalog.value <<<"$BUNDLE_JSON")"
WAREHOUSE_ID="$(jq -r .variables.warehouse_id.value <<<"$BUNDLE_JSON")"

scripts/check_bundle_name.sh "$TARGET"
if ! databricks current-user me -o json | jq -e '.groups[]? | select(.display == "admins")' >/dev/null; then
  echo "You are not a workspace admin. The setup creates service principals and account groups, which needs one. Run this script as a workspace admin." >&2
  exit 1
fi
if ! databricks catalogs get "$CATALOG" >/dev/null; then
  echo "Catalog $CATALOG doesn't exist or you can't read it. Create it, or set catalog in $OVERRIDES, then run this script again." >&2
  exit 1
fi
if ! databricks warehouses get "$WAREHOUSE_ID" >/dev/null; then
  echo "SQL warehouse $WAREHOUSE_ID doesn't exist or you can't use it. Set warehouse_id in $OVERRIDES, then run this script again." >&2
  exit 1
fi
if ! TAG_POLICIES="$(databricks tag-policies list-tag-policies -o json)"; then
  echo "Could not read the account's tag policies, which cost_tags must follow. Run this script as a user who can list them, then again." >&2
  exit 1
fi
REFUSED_TAGS="$(jq -r --argjson tags "$(jq -c .variables.cost_tags.value <<<"$BUNDLE_JSON")" '
  [.[] | select((.values // []) | length > 0) | {key: .tag_key, allowed: [.values[].name]}] as $policies
  | [$tags[] | . as $tag | $policies[] | select(.key == $tag.key and ((.allowed | index($tag.value)) | not))
     | "\($tag.key)=\($tag.value) (allowed: \(.allowed | join(", ")))"] | join("; ")' <<<"$TAG_POLICIES")"
if [[ -n "$REFUSED_TAGS" ]]; then
  echo "The account's tag policies refuse these cost_tags: $REFUSED_TAGS. Set cost_tags in $OVERRIDES to keys and values they allow, then run this script again." >&2
  exit 1
fi

scripts/setup_identities.sh "$TARGET"
if [[ "$TARGET" == demo ]]; then
  demo/add_demo_users.sh "$TARGET"
fi
databricks bundle deploy -t "$TARGET"
databricks bundle run -t "$TARGET" schema
if jq -e '.resources.jobs.reset_data' <<<"$BUNDLE_JSON" >/dev/null; then
  databricks bundle run -t "$TARGET" reset_data
fi
scripts/deploy_agent.sh "$TARGET"
scripts/setup_identities.sh "$TARGET"
echo "$TARGET is deployed. Finish the human steps in docs/deployment.md#required-setup, then run the suites in docs/development.md#tests."
