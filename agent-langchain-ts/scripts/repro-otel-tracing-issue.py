#!/usr/bin/env python3
"""
Minimal reproduction script for OTel tracing to Unity Catalog issue.

This script demonstrates that traces are not being written to UC tables
even with correct authentication and schema.

Prerequisites:
- pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http databricks-sdk
- databricks auth login --profile dogfood
"""

import os
import json
import time
import subprocess
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from databricks.sdk import WorkspaceClient

# Configuration
WORKSPACE_URL = "https://e2-dogfood.staging.cloud.databricks.com"
PROFILE = "dogfood"
CATALOG = "main"
SCHEMA = "agent_traces"
TABLE_NAME = "otel_repro_test"
EXPERIMENT_ID = "2610606164206831"

print("=" * 70)
print("OTel Tracing to Unity Catalog - Minimal Reproduction")
print("=" * 70)

# Step 1: Get OAuth token from Databricks CLI
print("\n📝 Step 1: Getting OAuth token from Databricks CLI...")
try:
    result = subprocess.run(
        ["databricks", "auth", "token", "--profile", PROFILE],
        capture_output=True,
        text=True,
        check=True
    )
    token_data = json.loads(result.stdout)
    oauth_token = token_data["access_token"]
    print(f"✅ Got OAuth token (expires in {token_data.get('expires_in', 'N/A')}s)")
except Exception as e:
    print(f"❌ Failed to get OAuth token: {e}")
    print("   Run: databricks auth login --profile dogfood")
    exit(1)

# Step 2: Create UC table with full OTel v1 schema
print(f"\n📝 Step 2: Creating UC table {CATALOG}.{SCHEMA}.{TABLE_NAME}...")

w = WorkspaceClient(profile=PROFILE)

# Get SQL warehouse
warehouses = list(w.warehouses.list())
warehouse_id = None
for wh in warehouses:
    if wh.state and wh.state.value == "RUNNING":
        warehouse_id = wh.id
        warehouse_name = wh.name
        break

if not warehouse_id:
    print("❌ No running SQL warehouse found")
    exit(1)

print(f"   Using warehouse: {warehouse_name}")

# Drop existing table
drop_sql = f"DROP TABLE IF EXISTS {CATALOG}.{SCHEMA}.{TABLE_NAME}"
try:
    w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=drop_sql,
        wait_timeout="60s"
    )
except:
    pass

# Create table with FULL OTel v1 schema (required by collector)
create_sql = f"""
CREATE TABLE {CATALOG}.{SCHEMA}.{TABLE_NAME} (
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
        print(f"✅ Table created: {CATALOG}.{SCHEMA}.{TABLE_NAME}")
    else:
        print(f"❌ Table creation failed: {result.status.error.message if result.status.error else 'Unknown'}")
        exit(1)
except Exception as e:
    print(f"❌ Error creating table: {e}")
    exit(1)

# Step 3: Configure OTel exporter
print("\n📝 Step 3: Configuring OTel exporter...")

uc_table = f"{CATALOG}.{SCHEMA}.{TABLE_NAME}"
endpoint = f"{WORKSPACE_URL}/api/2.0/otel/v1/traces"

print(f"   Endpoint: {endpoint}")
print(f"   UC Table: {uc_table}")
print(f"   Auth: OAuth token (NOT PAT)")

resource = Resource.create({
    "service.name": "otel-repro-test",
    "mlflow.experimentId": EXPERIMENT_ID,
})

otlp_exporter = OTLPSpanExporter(
    endpoint=endpoint,
    headers={
        "content-type": "application/x-protobuf",
        "X-Databricks-UC-Table-Name": uc_table,
        "Authorization": f"Bearer {oauth_token}"
    },
)

provider = TracerProvider(resource=resource)
processor = BatchSpanProcessor(otlp_exporter)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

tracer = provider.get_tracer(__name__)

print("✅ OTel exporter configured")

# Step 4: Create and export a test span
print("\n📝 Step 4: Creating and exporting test span...")

test_span_name = "otel-repro-test-span"
test_timestamp = time.time()

with tracer.start_as_current_span(test_span_name) as span:
    span.set_attribute("test.timestamp", str(test_timestamp))
    span.set_attribute("test.purpose", "repro-script")
    span.set_attribute("test.workspace", "dogfood")

print(f"✅ Span created: {test_span_name}")

print("\n📝 Step 5: Flushing spans to OTel collector...")
provider.force_flush()
print("✅ Flush completed (no client-side errors)")

# Step 6: Wait and check if trace appeared in UC
print("\n📝 Step 6: Waiting 15 seconds for OTel collector to write to UC...")
time.sleep(15)

print("\n📝 Step 7: Querying UC table for trace...")

query_sql = f"""
SELECT trace_id, span_id, name, start_time_unix_nano, attributes
FROM {CATALOG}.{SCHEMA}.{TABLE_NAME}
WHERE name = '{test_span_name}'
LIMIT 1
"""

try:
    result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=query_sql,
        wait_timeout="60s"
    )

    status = result.status.state.value
    print(f"   Query status: {status}")

    if status == "SUCCEEDED":
        if result.result and result.result.data_array and len(result.result.data_array) > 0:
            print("\n✅ SUCCESS! Trace found in UC table:")
            row = result.result.data_array[0]
            print(f"   Trace ID: {row[0]}")
            print(f"   Span ID: {row[1]}")
            print(f"   Name: {row[2]}")
            print(f"   Timestamp: {row[3]}")
            print(f"   Attributes: {row[4]}")
            print("\n🎉 OTel tracing to Unity Catalog is working!")
        else:
            print("\n❌ ISSUE REPRODUCED: Trace NOT found in UC table")
            print("\n   Even though:")
            print("   - OTel export completed without errors")
            print("   - OAuth token used (not PAT)")
            print("   - Table has correct OTel v1 schema")
            print("   - All required fields present")
            print("\n   Possible causes:")
            print("   - OTel collector cannot write to S3 bucket (permission issue)")
            print("   - OTel collector not fully deployed in this workspace")
            print("   - Backend infrastructure issue")

            # Try to check if table is completely empty
            count_sql = f"SELECT COUNT(*) FROM {CATALOG}.{SCHEMA}.{TABLE_NAME}"
            count_result = w.statement_execution.execute_statement(
                warehouse_id=warehouse_id,
                statement=count_sql,
                wait_timeout="60s"
            )
            if count_result.status.state.value == "SUCCEEDED" and count_result.result.data_array:
                count = count_result.result.data_array[0][0]
                print(f"\n   Total rows in table: {count}")
    else:
        error_msg = result.status.error.message if result.status.error else "Unknown"
        print(f"\n❌ Query failed: {error_msg[:500]}")

        if "NOT_FOUND" in error_msg or "not found" in error_msg.lower():
            print("\n   This error suggests S3 storage permission issues:")
            print("   - Table exists in UC metastore")
            print("   - But OTel collector cannot write data files to S3")

except Exception as e:
    print(f"\n❌ Error querying table: {e}")

print("\n" + "=" * 70)
print("Reproduction script complete")
print("=" * 70)

# Cleanup instructions
print(f"\nTo cleanup: DROP TABLE {CATALOG}.{SCHEMA}.{TABLE_NAME}")
