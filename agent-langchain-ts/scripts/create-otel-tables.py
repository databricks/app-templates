#!/usr/bin/env python3
"""
Create Unity Catalog tables for OpenTelemetry trace storage.

This script creates the required UC tables for the Databricks OTel collector.
"""

import os
import sys
from databricks import sql


def create_otel_tables():
    """Create Unity Catalog tables for OTel traces."""

    # Get connection details from environment
    host = os.environ.get("DATABRICKS_HOST", "https://e2-dogfood.staging.cloud.databricks.com")
    # Remove https:// prefix if present
    if host.startswith("https://"):
        host = host[8:]
    elif host.startswith("http://"):
        host = host[7:]

    # Get token from databricks CLI
    import subprocess
    import json

    try:
        result = subprocess.run(
            ["databricks", "auth", "token", "--profile", "dogfood"],
            capture_output=True,
            text=True,
            check=True
        )
        token_data = json.loads(result.stdout)
        token = token_data["access_token"]
    except Exception as e:
        print(f"❌ Error getting auth token: {e}")
        print("Make sure databricks CLI is configured with 'dogfood' profile")
        return False

    print(f"🔌 Connecting to {host}...")

    try:
        # Connect to Databricks SQL
        connection = sql.connect(
            server_hostname=host,
            http_path="/sql/1.0/warehouses/000000000000000d",  # Reyden Warehouse
            access_token=token
        )

        cursor = connection.cursor()

        # Schema already created, just create the table
        print("📋 Creating otel_spans table...")

        create_table_sql = """
        CREATE TABLE IF NOT EXISTS main.agent_traces.otel_spans (
          trace_id STRING,
          span_id STRING,
          parent_span_id STRING,
          name STRING,
          kind STRING,
          start_time TIMESTAMP,
          end_time TIMESTAMP,
          attributes MAP<STRING, STRING>,
          events ARRAY<STRUCT<
            timestamp: TIMESTAMP,
            name: STRING,
            attributes: MAP<STRING, STRING>
          >>,
          status_code STRING,
          status_message STRING,
          resource_attributes MAP<STRING, STRING>
        ) USING DELTA
        """

        cursor.execute(create_table_sql)
        print("✅ Table main.agent_traces.otel_spans created successfully")

        # Try to set table properties (might fail if not supported)
        try:
            cursor.execute(
                "ALTER TABLE main.agent_traces.otel_spans "
                "SET TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')"
            )
            print("✅ Enabled Change Data Feed on table")
        except Exception as e:
            print(f"⚠️  Could not enable Change Data Feed: {e}")

        # Grant permissions to myself
        print("🔐 Granting permissions...")
        try:
            cursor.execute("GRANT USE_CATALOG ON CATALOG main TO `sid.murching@databricks.com`")
            cursor.execute("GRANT USE_SCHEMA ON SCHEMA main.agent_traces TO `sid.murching@databricks.com`")
            cursor.execute("GRANT MODIFY, SELECT ON TABLE main.agent_traces.otel_spans TO `sid.murching@databricks.com`")
            print("✅ Permissions granted successfully")
        except Exception as e:
            print(f"⚠️  Could not grant all permissions: {e}")
            print("   (You may already have these permissions)")

        # Verify table exists
        print("\n📊 Verifying table...")
        cursor.execute("DESCRIBE TABLE main.agent_traces.otel_spans")
        columns = cursor.fetchall()
        print(f"✅ Table has {len(columns)} columns")

        cursor.close()
        connection.close()

        print("\n✅ All done! Table ready for OTel traces.")
        print("\n📝 Next steps:")
        print("   1. Set OTEL_UC_TABLE_NAME=main.agent_traces.otel_spans in .env")
        print("   2. Test locally: npm run dev:agent")
        print("   3. Send test request and check for traces in the table")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = create_otel_tables()
    sys.exit(0 if success else 1)
