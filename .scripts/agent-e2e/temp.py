"""Check if databricks_writer_16490 and databricks_gateway have grants on public schema."""
from databricks_ai_bridge.lakebase import LakebaseClient

client = LakebaseClient(instance_name="bbqiu")
try:
    # Check schema ACLs
    rows = client.execute("SELECT nspname, nspacl FROM pg_namespace WHERE nspname IN ('public', 'drizzle', 'ai_chatbot');")
    for row in rows:
        print(f"\n=== Schema: {row['nspname']} ===")
        if row['nspacl']:
            for acl in row['nspacl']:
                print(f"  {acl}")

    # Check if databricks_writer/gateway are members of any role with grants
    print("\n=== All role memberships ===")
    rows = client.execute("""
        SELECT r.rolname AS role, m.rolname AS member
        FROM pg_auth_members am
        JOIN pg_roles r ON r.oid = am.roleid
        JOIN pg_roles m ON m.oid = am.member
        ORDER BY r.rolname, m.rolname;
    """)
    for row in rows:
        print(f"  {row['member']} -> member of -> {row['role']}")

    # Check default privileges
    print("\n=== Default ACLs ===")
    rows = client.execute("SELECT * FROM pg_default_acl;")
    for row in rows:
        print(f"  {row}")
finally:
    client.close()
