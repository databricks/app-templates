#!/usr/bin/env bash
set -euo pipefail

# Usage: ./get-pghost.sh [optional-db-instance-name]
# Example:
#   ./get-pghost.sh
#   ./get-pghost.sh chatbot-lakebase-dev-otheruser

if [[ $# -gt 0 ]]; then
  DB_INSTANCE_NAME="$1"
else
  DOMAIN_FRIENDLY_USERNAME=$(
    databricks auth describe --output json |
    jq -r '.username' |
    cut -d'@' -f1 |
    tr '[:upper:]' '[:lower:]' |
    sed 's/[^a-z0-9]/-/g'
  )
  DB_INSTANCE_NAME="chatbot-lakebase-dev-$DOMAIN_FRIENDLY_USERNAME"
fi

PGHOST=$(databricks database get-database-instance "$DB_INSTANCE_NAME" | jq -r .read_write_dns)

if [[ -z "$PGHOST" || "$PGHOST" == "null" ]]; then
  echo "❌ Failed to find database instance or read_write_dns for: $DB_INSTANCE_NAME" >&2
  exit 1
fi

echo "$PGHOST"
