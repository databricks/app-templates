"""Grant Lakebase Postgres permissions to a Databricks Apps service principal.

After deploying the app, run this script to grant the app's SP access to all
Lakebase schemas and tables used by the long-term memory agent.

Usage:
    # Get the SP client ID from your deployed app:
    databricks apps get <app-name> --output json | jq -r '.service_principal_client_id'

    # Provisioned instance (reads LAKEBASE_INSTANCE_NAME from .env, or pass directly):
    uv run python scripts/grant_lakebase_permissions.py <sp-client-id> --instance-name <name>

    # Autoscaling instance (reads from .env, or pass directly):
    uv run python scripts/grant_lakebase_permissions.py <sp-client-id> --project <project> --branch <branch>
"""

import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()


# Schema -> table definitions for LangGraph long-term memory.
# public: store tables (created by AsyncDatabricksStore)
# ai_chatbot: chat UI persistence (drizzle ORM tables)
# drizzle: drizzle migration tracking
SCHEMA_TABLES: dict[str, list[str]] = {
    "public": [
        "store_migrations",
        "store",
        "store_vectors",
        "vector_migrations",
    ],
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
        "databricks apps get <app-name> --output json "
        "| jq -r '.service_principal_client_id'",
    )
    parser.add_argument(
        "--instance-name",
        default=os.getenv("LAKEBASE_INSTANCE_NAME"),
        help="Lakebase instance name for provisioned instances (default: LAKEBASE_INSTANCE_NAME from .env)",
    )
    parser.add_argument(
        "--project",
        default=os.getenv("LAKEBASE_AUTOSCALING_PROJECT"),
        help="Lakebase autoscaling project name (default: LAKEBASE_AUTOSCALING_PROJECT from .env)",
    )
    parser.add_argument(
        "--branch",
        default=os.getenv("LAKEBASE_AUTOSCALING_BRANCH"),
        help="Lakebase autoscaling branch name (default: LAKEBASE_AUTOSCALING_BRANCH from .env)",
    )
    parser.add_argument(
        "--autoscaling-endpoint",
        default=os.getenv("LAKEBASE_AUTOSCALING_ENDPOINT"),
        help="Lakebase autoscaling endpoint URL (default: LAKEBASE_AUTOSCALING_ENDPOINT from .env)",
    )
    args = parser.parse_args()

    has_provisioned = bool(args.instance_name)
    has_autoscaling = bool(args.project and args.branch)
    has_endpoint = bool(args.autoscaling_endpoint)

    if not has_provisioned and not has_autoscaling and not has_endpoint:
        print(
            "Error: Lakebase connection is required. Provide one of:\n"
            "  Provisioned:  --instance-name <name>  (or set LAKEBASE_INSTANCE_NAME in .env)\n"
            "  Autoscaling:  --project <proj> --branch <branch>  (or set LAKEBASE_AUTOSCALING_PROJECT + LAKEBASE_AUTOSCALING_BRANCH in .env)\n"
            "  Endpoint:     --autoscaling-endpoint <url>  (or set LAKEBASE_AUTOSCALING_ENDPOINT in .env)",
            file=sys.stderr,
        )
        sys.exit(1)

    from databricks_ai_bridge.lakebase import (
        LakebaseClient,
        SchemaPrivilege,
        TablePrivilege,
    )

    client = LakebaseClient(
        instance_name=args.instance_name or None,
        project=args.project or None,
        branch=args.branch or None,
        autoscaling_endpoint=args.autoscaling_endpoint or None,
    )
    sp_id = args.sp_client_id

    if has_provisioned:
        print(f"Using provisioned instance: {args.instance_name}")
    elif has_autoscaling:
        print(f"Using autoscaling project: {args.project}, branch: {args.branch}")
    else:
        print(f"Using autoscaling endpoint: {args.autoscaling_endpoint}")

    # 1. Create role
    print(f"Creating role for SP {sp_id}...")
    try:
        client.create_role(sp_id, "SERVICE_PRINCIPAL")
        print("  Role created.")
    except Exception as e:
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
    ]

    for schema, tables in SCHEMA_TABLES.items():
        print(f"Granting schema privileges on '{schema}'...")
        try:
            client.grant_schema(
                grantee=sp_id, schemas=[schema], privileges=schema_privileges
            )
        except Exception as e:
            print(f"  Warning: schema grant failed (may not exist yet): {e}")

        qualified_tables = [f"{schema}.{t}" for t in tables]
        print(f"  Granting table privileges on {qualified_tables}...")
        try:
            client.grant_table(
                grantee=sp_id, tables=qualified_tables, privileges=table_privileges
            )
        except Exception as e:
            print(f"  Warning: table grant failed (may not exist yet): {e}")

    print(
        "\nPermission grants complete. If some grants failed because tables don't "
        "exist yet, that's expected on a fresh branch — they'll be created on first "
        "agent usage. Re-run this script after the first run to grant remaining permissions."
    )


if __name__ == "__main__":
    main()
