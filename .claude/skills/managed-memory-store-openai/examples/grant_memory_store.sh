#!/usr/bin/env bash
# Grant memory-store access — a one-time CONTROL-PLANE step you run as YOURSELF (not from the app).
# (DAB does not yet support a MEMORY_STORE securable grant, so this is the manual path.)
#
# Prerequisite: you must be able to manage the store's permissions — i.e. you OWN the store or hold
# MANAGE_ACCESS_CONTROL on it. Creating a store (Step 1, Option B) makes you the owner.
#
# Usage:
#   export DATABRICKS_HOST="https://<your-workspace-host>"                                  # your workspace URL
#   export TOKEN="$(databricks auth token -p <profile> | jq -r .access_token)"
#   export STORE="main.default.agent_memory"        # the MEMORY_STORE full name (catalog.schema.name)
#   export APP_NAME="agent-openai-advanced"          # your deployed Databricks App (for Step 2)
#   export MY_USER="me@my-org.com"                    # your username (for local Step 3)
#   bash grant_memory_store.sh create   # Step 1B: create a store you own (needs CREATE_MEMORY_STORE on the schema)
#   bash grant_memory_store.sh get      # confirm an existing store resolves (catches a typo'd name)
#   bash grant_memory_store.sh app      # Step 2 : grant the deployed app's SP read+write
#   bash grant_memory_store.sh me       # Step 3 : grant your own user read+write (local testing)
#   bash grant_memory_store.sh verify   # show current grants
set -euo pipefail
: "${DATABRICKS_HOST:?set DATABRICKS_HOST}" "${TOKEN:?set TOKEN}" "${STORE:?set STORE (catalog.schema.name)}"
API="$DATABRICKS_HOST/api/2.1/unity-catalog"
auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

case "${1:-verify}" in
  create)  # Step 1, Option B — create a store you own
    cat_name="${STORE%%.*}"; rest="${STORE#*.}"; sch_name="${rest%%.*}"; name="${STORE##*.}"
    curl -sS --fail-with-body -X POST "$API/memory-stores" "${auth[@]}" \
      -d "{\"name\":\"$name\",\"catalog_name\":\"$cat_name\",\"schema_name\":\"$sch_name\",\"description\":\"Long-term memory for my agent\"}"
    echo "  -> created $STORE (you are the owner)";;
  get)     # confirm a store exists (the "use an existing store" path)
    curl -sS --fail-with-body "$API/memory-stores/$STORE" "${auth[@]}";;
  app)     # Step 2 — grant the deployed app's service principal
    : "${APP_NAME:?set APP_NAME (your deployed Databricks App)}"
    APP_SP=$(databricks apps get "$APP_NAME" -o json | jq -r .service_principal_client_id)
    curl -sS --fail-with-body -X PATCH "$API/permissions/memory_store/$STORE" "${auth[@]}" \
      -d "{\"changes\":[{\"principal\":\"$APP_SP\",\"add\":[\"READ_MEMORY_STORE\",\"WRITE_MEMORY_STORE\"]}]}"
    echo "  -> granted app SP $APP_SP READ+WRITE on $STORE";;
  me)      # Step 3 — grant your own user (local: the agent runs as you, not the SP)
    : "${MY_USER:?set MY_USER (your username/email)}"
    curl -sS --fail-with-body -X PATCH "$API/permissions/memory_store/$STORE" "${auth[@]}" \
      -d "{\"changes\":[{\"principal\":\"$MY_USER\",\"add\":[\"READ_MEMORY_STORE\",\"WRITE_MEMORY_STORE\"]}]}"
    echo "  -> granted $MY_USER READ+WRITE on $STORE";;
  verify)
    curl -sS --fail-with-body "$API/permissions/memory_store/$STORE" "${auth[@]}";;
  *) echo "usage: $0 {create|get|app|me|verify}"; exit 2;;
esac
