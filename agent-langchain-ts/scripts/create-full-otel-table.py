#!/usr/bin/env python3
"""
Create a Unity Catalog table with the FULL official OTel v1 schema.
This matches what the MLflow public preview API would create.
"""

from databricks.sdk import WorkspaceClient

w = WorkspaceClient(profile="dogfood")

# Get warehouse
warehouses = w.warehouses.list()
warehouse_id = None
for wh in warehouses:
    if wh.state and wh.state.value == "RUNNING":
        warehouse_id = wh.id
        warehouse_name = wh.name
        break

print("📊 Creating full OTel v1 schema table...")
print(f"   SQL Warehouse: {warehouse_name}\n")

# Drop existing table first
drop_sql = "DROP TABLE IF EXISTS main.agent_traces.otel_spans_full"

try:
    result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=drop_sql,
        wait_timeout="60s"
    )
    print("🗑️  Dropped existing table (if any)")
except Exception as e:
    print(f"Note: {e}")

# Full OTel v1 schema matching official spec
create_sql = """
CREATE TABLE main.agent_traces.otel_spans_full (
  trace_id STRING NOT NULL,
  span_id STRING NOT NULL,
  trace_state STRING,
  parent_span_id STRING,
  flags INT,
  name STRING NOT NULL,
  kind STRING NOT NULL,
  start_time_unix_nano BIGINT NOT NULL,
  end_time_unix_nano BIGINT NOT NULL,
  attributes MAP<STRING, STRING>,
  dropped_attributes_count INT,
  events ARRAY<STRUCT<
    time_unix_nano: BIGINT,
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
TBLPROPERTIES ('otel.schemaVersion' = 'v1')
"""

try:
    result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=create_sql,
        wait_timeout="120s"
    )

    if result.status.state.value == "SUCCEEDED":
        print("✅ Table created: main.agent_traces.otel_spans_full")
        print("\n📝 Update .env with:")
        print("   OTEL_UC_TABLE_NAME=main.agent_traces.otel_spans_full")
        print("\n✅ Ready to test tracing!")
    else:
        print(f"❌ Failed: {result.status.error.message if result.status.error else 'Unknown'}")

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
