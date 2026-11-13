#!/usr/bin/env bash
set -euo pipefail

BUNDLE_JSON="$(databricks bundle validate ${1:+-t "$1"} -o json)"
BUNDLE_NAME="$(jq -r .bundle.name <<<"$BUNDLE_JSON")"
PROJECT="$(jq -r .variables.project.value <<<"$BUNDLE_JSON")"

if [[ "$BUNDLE_NAME" != "$PROJECT" ]]; then
  echo "databricks.yml names the bundle \"$BUNDLE_NAME\", but the project is \"$PROJECT\". Set bundle.name to \"$PROJECT\", then run the command again: projects with one bundle name in a workspace share its deployment state." >&2
  exit 1
fi
