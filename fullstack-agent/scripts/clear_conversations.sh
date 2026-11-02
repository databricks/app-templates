#!/usr/bin/env bash
set -euo pipefail

STORE="$(grep -A1 '^\[session_store\]' app/agent.toml | sed -n 's/^name = "\(.*\)"$/\1/p')"
BUNDLE_JSON="$(databricks bundle validate -o json)"
ACTORS=(
  "$(databricks current-user me -o json | jq -r .userName)"
  "$(jq -r '.variables.test_user_one_id.value // empty' <<<"$BUNDLE_JSON")"
  "$(jq -r '.variables.test_user_two_id.value // empty' <<<"$BUNDLE_JSON")"
)
SESSIONS="/api/2.0/agents/session-stores/$STORE/sessions"

for actor in "${ACTORS[@]}"; do
  [[ -n "$actor" ]] || continue
  filter="$(jq -rn --arg actor "$actor" '"actor_id = \"\($actor)\"" | @uri')"
  deleted=0
  while :; do
    ids="$(databricks api get "$SESSIONS?filter=$filter&page_size=100" | jq -r '.sessions[]?.session_id')"
    [[ -z "$ids" ]] && break
    while read -r id; do
      databricks api delete "$SESSIONS/$id" >/dev/null
      deleted=$((deleted + 1))
    done <<<"$ids"
  done
  echo "deleted $deleted conversations of $actor from $STORE"
done
