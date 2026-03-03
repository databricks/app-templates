"""Inspect a Lakebase instance: schemas, table rows, and role permissions."""

import argparse

from databricks_ai_bridge.lakebase import LakebaseClient

SYSTEM_SCHEMAS = frozenset({
    "__db_system",
    "information_schema",
    "pg_catalog",
    "pg_toast",
})


def inspect(instance_name: str, *, include_system: bool = False):
    client = LakebaseClient(instance_name=instance_name)
    try:
        # 1. All schemas
        schemas = client.execute(
            "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;"
        )
        all_schema_names = [r["schema_name"] for r in schemas]
        schema_names = [
            s for s in all_schema_names
            if include_system or s not in SYSTEM_SCHEMAS
        ]
        print("=" * 60)
        print("SCHEMAS")
        print("=" * 60)
        for s in all_schema_names:
            skipped = " (skipped)" if s in SYSTEM_SCHEMAS and not include_system else ""
            print(f"  {s}{skipped}")

        # 2. First 10 rows of every table in each schema
        print("\n" + "=" * 60)
        print("TABLE PREVIEWS (first 10 rows)")
        print("=" * 60)
        for schema in schema_names:
            tables = client.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = %s ORDER BY table_name;",
                (schema,),
            )
            if not tables:
                continue
            print(f"\n--- Schema: {schema} ---")
            for t in tables:
                table_name = t["table_name"]
                qualified = f'"{schema}"."{table_name}"'
                print(f"\n  >> {qualified}")
                try:
                    rows = client.execute(f"SELECT * FROM {qualified} LIMIT 10;")
                    if not rows:
                        print("     (empty)")
                    else:
                        cols = list(rows[0].keys())
                        print(f"     columns: {cols}")
                        for i, row in enumerate(rows):
                            print(f"     [{i}] {dict(row)}")
                except Exception as exc:
                    print(f"     ERROR: {exc}")

        # 3. Role permissions per table
        print("\n" + "=" * 60)
        print("TABLE PERMISSIONS (postgres roles)")
        print("=" * 60)
        for schema in schema_names:
            tables = client.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = %s ORDER BY table_name;",
                (schema,),
            )
            if not tables:
                continue
            print(f"\n--- Schema: {schema} ---")
            for t in tables:
                table_name = t["table_name"]
                qualified = f"{schema}.{table_name}"
                print(f"\n  >> {qualified}")
                try:
                    grants = client.execute(
                        "SELECT grantee, privilege_type, is_grantable "
                        "FROM information_schema.role_table_grants "
                        "WHERE table_schema = %s AND table_name = %s "
                        "ORDER BY grantee, privilege_type;",
                        (schema, table_name),
                    )
                    if not grants:
                        print("     (no grants found)")
                    else:
                        current_grantee = None
                        for g in grants:
                            if g["grantee"] != current_grantee:
                                current_grantee = g["grantee"]
                                print(f"     {current_grantee}:")
                            grantable = " (WITH GRANT OPTION)" if g["is_grantable"] == "YES" else ""
                            print(f"       - {g['privilege_type']}{grantable}")
                except Exception as exc:
                    print(f"     ERROR: {exc}")
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Inspect a Lakebase instance")
    parser.add_argument("instance", help="Lakebase instance name")
    parser.add_argument(
        "--include-system",
        action="store_true",
        help="Include system schemas (information_schema, pg_catalog, etc.)",
    )
    args = parser.parse_args()
    inspect(args.instance, include_system=args.include_system)
