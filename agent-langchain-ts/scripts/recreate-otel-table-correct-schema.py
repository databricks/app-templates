#!/usr/bin/env python3
"""
Recreate the OTel spans table with the correct official schema.
Based on Databricks OTel documentation.
"""

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

w = WorkspaceClient(profile="dogfood")
print("🔌 Connected as:", w.current_user.me().user_name)

# Get warehouse
warehouses = w.warehouses.list()
warehouse_id = None
for wh in warehouses:
    if wh.state and wh.state.value == "RUNNING":
        warehouse_id = wh.id
        print(f"✅ Using warehouse: {wh.name}")
        break

# Drop old table
print("\n🗑️  Dropping old table...")
drop_sql = "DROP TABLE IF EXISTS main.agent_traces.otel_spans"
result = w.statement_execution.execute_statement(
    warehouse_id=warehouse_id,
    statement=drop_sql,
    wait_timeout="30s"
)
if result.status.state == StatementState.SUCCEEDED:
    print("✅ Old table dropped")

# Create table with correct official schema
print("\n📋 Creating table with official OTel schema...")

create_sql = """
CREATE TABLE main.agent_traces.otel_spans (
  trace_id STRING,
  span_id STRING,
  trace_state STRING,
  parent_span_id STRING,
  flags INT,
  name STRING,
  kind STRING,
  start_time_unix_nano LONG,
  end_time_unix_nano LONG,
  attributes MAP<STRING, STRING>,
  dropped_attributes_count INT,
  events ARRAY<STRUCT<
    time_unix_nano: LONG,
    name: STRING,
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >>,
  dropped_events_count INT,
  links ARRAY<STRUCT<
    trace_id: STRING,
    span_id: STRING,
    trace_state: STRING,
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT,
    flags: INT
  >>,
  dropped_links_count INT,
  status STRUCT<
    message: STRING,
    code: STRING
  >,
  resource STRUCT<
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >,
  resource_schema_url STRING,
  instrumentation_scope STRUCT<
    name: STRING,
    version: STRING,
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >,
  span_schema_url STRING
) USING DELTA
TBLPROPERTIES (
  'otel.schemaVersion' = 'v1'
)
"""

result = w.statement_execution.execute_statement(
    warehouse_id=warehouse_id,
    statement=create_sql,
    wait_timeout="60s"
)

if result.status.state == StatementState.SUCCEEDED:
    print("✅ Table created with official schema")

    # Verify
    verify_sql = "DESCRIBE TABLE main.agent_traces.otel_spans"
    verify_result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=verify_sql,
        wait_timeout="30s"
    )

    if verify_result.result and verify_result.result.data_array:
        print(f"✅ Table verified with {len(verify_result.result.data_array)} columns")
        print("\n📝 Key columns:")
        for row in verify_result.result.data_array[:10]:
            print(f"   {row[0]}: {row[1]}")

    print("\n✅ Table ready for OTel traces!")
    print("   Table: main.agent_traces.otel_spans")
    print("   Schema: Official OTel v1 format")
else:
    print(f"❌ Failed: {result.status.state}")
    if result.status.error:
        print(f"   Error: {result.status.error.message}")
