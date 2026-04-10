"""Grant Lakebase Postgres permissions to a Databricks Apps service principal or the current user.

After deploying the app, run this script to grant the app's SP access to all
Lakebase schemas and tables used by the agent's memory.

Usage:
    # Get the SP client ID from your deployed app:
    databricks apps get <app-name> --output json | jq -r '.service_principal_client_id'

    # Provisioned instance:
    uv run python scripts/grant_lakebase_permissions.py <sp-client-id> --memory-type langgraph --instance-name <name>

    # Autoscaling instance:
    uv run python scripts/grant_lakebase_permissions.py <sp-client-id> --memory-type openai --project <project> --branch <branch>

    # Grant to current user (for local development):
    uv run python scripts/grant_lakebase_permissions.py --grant-self --memory-type langgraph

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


def _try_sql(client, sql: str):
    """Execute SQL, logging but not raising on failure."""
    try:
        client.execute(sql)
    except Exception as exc:
        print(f"  SQL warning: {exc!r} for: {sql}")


def _grant_permissions(client, grantee: str, memory_types: list[str], grant_self: bool = False):
    """Grant all permissions for the given memory types to the grantee role."""
    from databricks_ai_bridge.lakebase import (
        SchemaPrivilege,
        SequencePrivilege,
        TablePrivilege,
    )

    quoted = f'"{grantee}"'

    # For --grant-self, grant CREATE ON DATABASE so the user can create schemas
    if grant_self:
        print(f"Granting CREATE ON DATABASE to {grantee}...")
        _try_sql(client, f"GRANT CREATE ON DATABASE databricks_postgres TO {quoted};")

    # Build combined schema -> tables map for all selected memory types
    schema_tables: dict[str, list[str]] = dict(SHARED_SCHEMAS)
    for mt in memory_types:
        for schema, tables in MEMORY_TYPE_SCHEMAS[mt].items():
            schema_tables.setdefault(schema, []).extend(tables)

    # Grant schema + table privileges
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
    for mt in memory_types:
        if mt in NEEDS_SEQUENCES:
            seq_schemas.extend(NEEDS_SEQUENCES[mt])
    # Deduplicate while preserving order
    seen = set()
    seq_schemas = [s for s in seq_schemas if not (s in seen or seen.add(s))]

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

    # For --grant-self, also grant via SET ROLE databricks_superuser as fallback
    # for tables/sequences owned by other users (e.g. from previous test runs)
    if grant_self:
        print("Attempting grants via SET ROLE databricks_superuser...")
        try:
            client.execute("SET ROLE databricks_superuser;")
            for schema, tables in schema_tables.items():
                _try_sql(
                    client,
                    f"GRANT ALL ON ALL TABLES IN SCHEMA {schema} TO {quoted};",
                )
                _try_sql(
                    client,
                    f"GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA {schema} TO {quoted};",
                )
                _try_sql(
                    client,
                    f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
                    f"GRANT ALL ON TABLES TO {quoted};",
                )
                _try_sql(
                    client,
                    f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
                    f"GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {quoted};",
                )
            client.execute("RESET ROLE;")
        except Exception as exc:
            print(f"  SET ROLE databricks_superuser failed: {exc}")
            try:
                client.execute("RESET ROLE;")
            except Exception:
                pass

    print(
        "\nPermission grants complete. If some grants failed because tables don't "
        "exist yet, that's expected on a fresh branch — they'll be created on first "
        "agent usage. Re-run this script after the first run to grant remaining permissions."
    )


def main():
    parser = argparse.ArgumentParser(
        description="Grant Lakebase permissions to an app service principal or the current user."
    )
    parser.add_argument(
        "sp_client_id",
        nargs="?",
        default=None,
        help="Service principal client ID (UUID). Not required when using --grant-self.",
    )
    parser.add_argument(
        "--grant-self",
        action="store_true",
        help="Grant permissions to the current Lakebase user (for local development).",
    )
    parser.add_argument(
        "--memory-type",
        required=True,
        nargs="+",
        choices=list(MEMORY_TYPE_SCHEMAS.keys()),
        help="Memory type(s) to grant permissions for. Can specify multiple.",
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

    if not args.grant_self and not args.sp_client_id:
        parser.error("sp_client_id is required when --grant-self is not specified")

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
        print(f"Memory types: {args.memory_type}")

        if args.grant_self:
            # Resolve current user from the database connection
            rows = client.execute("SELECT current_user;")
            grantee = rows[0]["current_user"]
            print(f"Granting permissions to current user: {grantee}")
        else:
            grantee = args.sp_client_id
            # Create role for SP
            print(f"Creating role for SP {grantee}...")
            try:
                client.create_role(grantee, "SERVICE_PRINCIPAL")
                print("  Role created.")
            except Exception as e:
                if "already exists" in str(e).lower():
                    print("  Role already exists, skipping.")
                else:
                    raise

        _grant_permissions(client, grantee, args.memory_type, grant_self=args.grant_self)


if __name__ == "__main__":
    main()
