"""Grant Lakebase Postgres permissions to a Databricks Apps service principal.

After deploying the app, run this script to grant the app's SP access to all
Lakebase schemas and tables used by the long-running agent.

Usage:
    # Get the SP client ID from your deployed app:
    databricks apps get <app-name> --profile <profile> --output json | jq -r '.service_principal_client_id'

    # Grant permissions:
    uv run python scripts/grant_lakebase_permissions.py <sp-client-id>
"""

import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()


# Schema -> table definitions for this template.
# agent_server: long-running agent persistence (responses + messages)
# ai_chatbot: chat UI persistence (drizzle ORM tables)
# drizzle: drizzle migration tracking
SCHEMA_TABLES: dict[str, list[str]] = {
    "agent_server": ["responses", "messages"],
    "ai_chatbot": ["Chat", "Message", "User", "Vote"],
    "drizzle": ["__drizzle_migrations"],
}


def main():
    parser = argparse.ArgumentParser(
        description="Grant Lakebase permissions to an app service principal."
    )
    parser.add_argument(
        "sp_client_id",
        help="Service principal client ID (UUID). Get it via: "
        "databricks apps get <app-name> --profile <profile> --output json "
        "| jq -r '.service_principal_client_id'",
    )
    parser.add_argument(
        "--instance-name",
        default=os.getenv("LAKEBASE_INSTANCE_NAME"),
        help="Lakebase instance name (default: LAKEBASE_INSTANCE_NAME from .env)",
    )
    args = parser.parse_args()

    if not args.instance_name:
        print(
            "Error: --instance-name is required (or set LAKEBASE_INSTANCE_NAME in .env)",
            file=sys.stderr,
        )
        sys.exit(1)

    from databricks_ai_bridge.lakebase import (
        LakebaseClient,
        SchemaPrivilege,
        TablePrivilege,
    )

    client = LakebaseClient(instance_name=args.instance_name)
    sp_id = args.sp_client_id

    # 1. Create role
    print(f"Creating role for SP {sp_id}...")
    try:
        client.create_role(sp_id, "SERVICE_PRINCIPAL")
        print("  Role created.")
    except ValueError as e:
        if "already exists" in str(e).lower():
            print("  Role already exists, skipping.")
        else:
            raise

    # 2. Grant schema + table privileges
    schema_privileges = [SchemaPrivilege.USAGE, SchemaPrivilege.CREATE]
    table_privileges = [
        TablePrivilege.SELECT,
        TablePrivilege.INSERT,
        TablePrivilege.UPDATE,
        TablePrivilege.DELETE,
    ]

    for schema, tables in SCHEMA_TABLES.items():
        print(f"Granting schema privileges on {schema}...")
        client.grant_schema(
            grantee=sp_id, schemas=[schema], privileges=schema_privileges
        )

        qualified_tables = [f"{schema}.{t}" for t in tables]
        print(f"  Granting table privileges on {qualified_tables}...")
        client.grant_table(
            grantee=sp_id, tables=qualified_tables, privileges=table_privileges
        )

    print("\nAll permissions granted successfully.")


if __name__ == "__main__":
    main()
