#!/usr/bin/env python3
"""Simple script to create UC table via SQL execution."""

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState
import time

def create_table():
    w = WorkspaceClient(profile="dogfood")

    print("🔌 Connected as:", w.current_user.me().user_name)

    # Get a running warehouse
    warehouses = w.warehouses.list()
    warehouse_id = None
    for wh in warehouses:
        if wh.state.value == "RUNNING":
            warehouse_id = wh.id
            print(f"✅ Using warehouse: {wh.name} ({warehouse_id})")
            break

    if not warehouse_id:
        print("❌ No running warehouse found")
        return False

    sql = """
CREATE TABLE IF NOT EXISTS main.agent_traces.otel_spans (
  trace_id STRING,
  span_id STRING,
  parent_span_id STRING,
  name STRING,
  kind STRING,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  attributes MAP<STRING, STRING>,
  events ARRAY<STRUCT<timestamp: TIMESTAMP, name: STRING, attributes: MAP<STRING, STRING>>>,
  status_code STRING,
  status_message STRING,
  resource_attributes MAP<STRING, STRING>
) USING DELTA
"""

    print("\n📋 Creating table main.agent_traces.otel_spans...")

    try:
        # Execute SQL statement
        result = w.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=sql,
            wait_timeout="60s"
        )

        if result.status.state == StatementState.SUCCEEDED:
            print("✅ Table created successfully!")

            # Verify table exists
            verify_sql = "DESCRIBE TABLE main.agent_traces.otel_spans"
            verify_result = w.statement_execution.execute_statement(
                warehouse_id=warehouse_id,
                statement=verify_sql,
                wait_timeout="30s"
            )

            if verify_result.status.state == StatementState.SUCCEEDED:
                print(f"✅ Table verified with {len(verify_result.result.data_array or [])} columns")

            print("\n📝 Configuration:")
            print("   OTEL_UC_TABLE_NAME=main.agent_traces.otel_spans")

            return True
        else:
            print(f"❌ Failed: {result.status.state}")
            if result.status.error:
                print(f"   Error: {result.status.error.message}")
            return False

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    import sys
    sys.exit(0 if create_table() else 1)
