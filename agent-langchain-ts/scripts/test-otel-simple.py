#!/usr/bin/env python3
"""
Simple OTel test based on Databricks documentation.
Tests basic span export to verify OTel collector is working.
"""

import os
import time
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource

# Configuration
WORKSPACE_URL = "https://e2-dogfood.staging.cloud.databricks.com"
UC_TABLE = "main.agent_traces.langchain_otel_spans"

# Get token
import subprocess
import json
result = subprocess.run(
    ["databricks", "auth", "token", "--profile", "dogfood"],
    capture_output=True,
    text=True,
    check=True
)
TOKEN = json.loads(result.stdout)["access_token"]

print("🧪 Testing Databricks OTel Collector")
print(f"   Endpoint: {WORKSPACE_URL}/api/2.0/otel/v1/traces")
print(f"   UC Table: {UC_TABLE}")
print()

# Configure OTel exporter
otlp_exporter = OTLPSpanExporter(
    endpoint=f"{WORKSPACE_URL}/api/2.0/otel/v1/traces",
    headers={
        "content-type": "application/x-protobuf",
        "X-Databricks-UC-Table-Name": UC_TABLE,
        "Authorization": f"Bearer {TOKEN}"
    },
)

# Create tracer provider
resource = Resource.create({"service.name": "otel-test-simple"})
provider = TracerProvider(resource=resource)
processor = BatchSpanProcessor(otlp_exporter)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

# Get tracer
tracer = trace.get_tracer(__name__)

# Create a simple span
print("📝 Creating test span...")
with tracer.start_as_current_span("test-span") as span:
    span.set_attribute("test.key", "test-value")
    span.set_attribute("test.number", 42)
    print("   Span created with attributes")
    time.sleep(0.5)

print("✅ Span completed")

# Force flush
print("🔄 Flushing spans to OTel collector...")
provider.force_flush()
print("✅ Flush complete")

print("\n⏳ Waiting 5 seconds for processing...")
time.sleep(5)

print("\n📊 Checking UC table for traces...")
from databricks.sdk import WorkspaceClient

w = WorkspaceClient(profile="dogfood")

# Get warehouse
warehouses = w.warehouses.list()
warehouse_id = None
for wh in warehouses:
    if wh.state and wh.state.value == "RUNNING":
        warehouse_id = wh.id
        break

sql = f"SELECT COUNT(*) as count FROM {UC_TABLE}"
result = w.statement_execution.execute_statement(
    warehouse_id=warehouse_id,
    statement=sql,
    wait_timeout="30s"
)

if result.result and result.result.data_array:
    count = result.result.data_array[0][0]
    if count > 0:
        print(f"✅ SUCCESS! Found {count} spans in UC table")

        # Show recent span
        sql2 = f"""
        SELECT name, trace_id, start_time_unix_nano, attributes
        FROM {UC_TABLE}
        ORDER BY start_time_unix_nano DESC
        LIMIT 1
        """
        result2 = w.statement_execution.execute_statement(
            warehouse_id=warehouse_id,
            statement=sql2,
            wait_timeout="30s"
        )
        if result2.result and result2.result.data_array:
            row = result2.result.data_array[0]
            print(f"\n📝 Latest span:")
            print(f"   Name: {row[0]}")
            print(f"   Trace ID: {row[1]}")
            print(f"   Start time: {row[2]}")
            print(f"   Attributes: {row[3]}")
    else:
        print("❌ No spans found in UC table")
        print("\nPossible issues:")
        print("1. Table schema doesn't match OTel format")
        print("2. OTel collector is rejecting traces")
        print("3. Permissions issue")
else:
    print("❌ Query failed")

print("\n✅ Test complete")
