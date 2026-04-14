"""Grant Lakebase Postgres permissions to a Databricks Apps service principal.

After deploying the app, run this script to grant the app's SP access to all
Lakebase schemas and tables used by the agent's memory.

Usage:
    # Get the SP client ID from your deployed app:
    databricks apps get <app-name> --output json | jq -r '.service_principal_client_id'

    # Provisioned instance:
    uv run python scripts/grant_lakebase_permissions.py <sp-client-id> --memory-type <type> --instance-name <name>

    # Autoscaling instance:
    uv run python scripts/grant_lakebase_permissions.py <sp-client-id> --memory-type <type> --project <project> --branch <branch>

    # Memory types: langgraph, openai
"""

import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()


# Per-memory-type schema -> table definitions.
MEMORY_TYPE_SCHEMAS: dict[str, dict[str, list[str]]] = {
    "langgraph": {
        "public": [
            "checkpoint_migrations",
            "checkpoint_writes",
            "checkpoints",
            "checkpoint_blobs",
            "store_migrations",
            "store",
            "store_vectors",
            "vector_migrations",
        ],
        "agent_server": [
            "responses",
            "messages",
        ],
    },
    "openai": {
        "public": [
            "agent_sessions",
            "agent_messages",
        ],
        "agent_server": [
            "responses",
            "messages",
        ],
    },
}

# Memory types that need sequence privileges (auto-increment columns)
NEEDS_SEQUENCES = {
    "openai": ["public", "agent_server"],
    "langgraph": ["agent_server"],
}

# Shared schemas that need sequence privileges for all memory types.
# Drizzle uses __drizzle_migrations with id SERIAL PRIMARY KEY, which
# requires USAGE, SELECT, UPDATE on the backing sequence.
SHARED_SEQUENCE_SCHEMAS = ["drizzle"]

# Shared schemas granted for all memory types (chat UI persistence)
SHARED_SCHEMAS: dict[str, list[str]] = {
    "ai_chatbot": ["Chat", "Message", "User", "Vote"],
    "drizzle": ["__drizzle_migrations"],
}


def _grant_permissions(client, grantee: str, memory_type: str):
    """Grant all permissions for the given memory type to the grantee role."""
    from databricks_ai_bridge.lakebase import (
        SchemaPrivilege,
        SequencePrivilege,
        TablePrivilege,
    )

    # Build schema -> tables map
    schema_tables: dict[str, list[str]] = dict(SHARED_SCHEMAS)
    for schema, tables in MEMORY_TYPE_SCHEMAS[memory_type].items():
        schema_tables.setdefault(schema, []).extend(tables)

    schema_privileges = [SchemaPrivilege.USAGE, SchemaPrivilege.CREATE]
    table_privileges = [
        TablePrivilege.SELECT,
        TablePrivilege.INSERT,
        TablePrivilege.UPDATE,
        TablePrivilege.DELETE,
    ]

    for schema, tables in schema_tables.items():
        print(f"Granting schema privileges on '{schema}'...")
        try:
            client.grant_schema(
                grantee=grantee, schemas=[schema], privileges=schema_privileges
            )
        except Exception as e:
            print(f"  Warning: schema grant failed (may not exist yet): {e}")

        qualified_tables = [f"{schema}.{t}" for t in tables]
        print(f"  Granting table privileges on {qualified_tables}...")
        try:
            client.grant_table(
                grantee=grantee, tables=qualified_tables, privileges=table_privileges
            )
        except Exception as e:
            print(f"  Warning: table grant failed (may not exist yet): {e}")

    # Grant sequence privileges (auto-increment columns).
    seq_schemas = list(SHARED_SEQUENCE_SCHEMAS)
    if memory_type in NEEDS_SEQUENCES:
        seq_schemas.extend(NEEDS_SEQUENCES[memory_type])

    for schema in seq_schemas:
        print(f"Granting sequence privileges on '{schema}' schema...")
        try:
            client.grant_all_sequences_in_schema(
                grantee=grantee,
                schemas=[schema],
                privileges=[
                    SequencePrivilege.USAGE,
                    SequencePrivilege.SELECT,
                    SequencePrivilege.UPDATE,
                ],
            )
        except Exception as e:
            print(f"  Warning: sequence grant failed (may not exist yet): {e}")

    print(
        "\nPermission grants complete. If some grants failed because tables don't "
        "exist yet, that's expected on a fresh branch — they'll be created on first "
        "agent usage. Re-run this script after the first run to grant remaining permissions."
    )


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
        "--memory-type",
        required=True,
        choices=list(MEMORY_TYPE_SCHEMAS.keys()),
        help="Memory type to grant permissions for",
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
    args = parser.parse_args()

    has_provisioned = bool(args.instance_name)
    has_autoscaling = bool(args.project and args.branch)

    if not has_provisioned and not has_autoscaling:
        print(
            "Error: Lakebase connection is required. Provide one of:\n"
            "  Provisioned:  --instance-name <name>  (or set LAKEBASE_INSTANCE_NAME in .env)\n"
            "  Autoscaling:  --project <proj> --branch <branch>  (or set LAKEBASE_AUTOSCALING_PROJECT + LAKEBASE_AUTOSCALING_BRANCH in .env)",
            file=sys.stderr,
        )
        sys.exit(1)

    from databricks_ai_bridge.lakebase import LakebaseClient

    with LakebaseClient(
        instance_name=args.instance_name or None,
        project=args.project or None,
        branch=args.branch or None,
    ) as client:
        if has_provisioned:
            print(f"Using provisioned instance: {args.instance_name}")
        else:
            print(f"Using autoscaling project: {args.project}, branch: {args.branch}")
        print(f"Memory type: {args.memory_type}")

        grantee = args.sp_client_id
        print(f"Creating role for SP {grantee}...")
        try:
            client.create_role(grantee, "SERVICE_PRINCIPAL")
            print("  Role created.")
        except Exception as e:
            if "already exists" in str(e).lower():
                print("  Role already exists, skipping.")
            else:
                raise

        _grant_permissions(client, grantee, args.memory_type)


if __name__ == "__main__":
    main()
