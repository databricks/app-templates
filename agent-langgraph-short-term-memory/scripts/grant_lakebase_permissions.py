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

    # Memory types: langgraph-short-term, langgraph-long-term, openai-short-term, long-running-agent
"""

import argparse
import os
import sys

from dotenv import load_dotenv

load_dotenv()


# Per-memory-type schema -> table definitions.
MEMORY_TYPE_SCHEMAS: dict[str, dict[str, list[str]]] = {
    "langgraph-short-term": {
        "public": [
            "checkpoint_migrations",
            "checkpoint_writes",
            "checkpoints",
            "checkpoint_blobs",
        ],
    },
    "langgraph-long-term": {
        "public": [
            "store_migrations",
            "store",
            "store_vectors",
            "vector_migrations",
        ],
    },
    "openai-short-term": {
        "public": [
            "agent_sessions",
            "agent_messages",
        ],
    },
    "long-running-agent": {
        "agent_server": [
            "responses",
            "messages",
        ],
    },
}

# Memory types that need sequence privileges on public schema
NEEDS_SEQUENCES = {"openai-short-term"}

# Shared schemas granted for all memory types (chat UI persistence)
SHARED_SCHEMAS: dict[str, list[str]] = {
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

    from databricks_ai_bridge.lakebase import (
        LakebaseClient,
        SchemaPrivilege,
        SequencePrivilege,
        TablePrivilege,
    )

    client = LakebaseClient(
        instance_name=args.instance_name or None,
        project=args.project or None,
        branch=args.branch or None,
    )
    sp_id = args.sp_client_id
    memory_type = args.memory_type

    if has_provisioned:
        print(f"Using provisioned instance: {args.instance_name}")
    else:
        print(f"Using autoscaling project: {args.project}, branch: {args.branch}")
    print(f"Memory type: {memory_type}")

    # Build schema -> tables map for the selected memory type
    schema_tables: dict[str, list[str]] = {
        **MEMORY_TYPE_SCHEMAS[memory_type],
        **SHARED_SCHEMAS,
    }

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
        TablePrivilege.DELETE,
    ]

    for schema, tables in schema_tables.items():
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

    # 3. Grant sequence privileges if needed (e.g. OpenAI SDK session tables)
    if memory_type in NEEDS_SEQUENCES:
        print("Granting sequence privileges on 'public' schema...")
        try:
            client.grant_all_sequences_in_schema(
                grantee=sp_id,
                schemas=["public"],
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


if __name__ == "__main__":
    main()
