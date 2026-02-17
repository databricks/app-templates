#!/usr/bin/env python3
"""
Minimal reproduction using MLflow's official set_experiment_trace_location() API.

This follows the exact pattern from Databricks documentation for OTel public preview.

Prerequisites:
- pip install 'mlflow[databricks]>=3.9.0' opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http databricks-sdk
- databricks auth login --profile dogfood
"""

import os
import json
import time
import subprocess
import signal
from contextlib import contextmanager
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from databricks.sdk import WorkspaceClient
import mlflow
from mlflow.entities import UCSchemaLocation
from mlflow.tracing.enablement import set_experiment_trace_location

# Configuration
WORKSPACE_URL = "https://e2-dogfood.staging.cloud.databricks.com"
PROFILE = "dogfood"
CATALOG = "main"
SCHEMA = "agent_traces"
EXPERIMENT_NAME = "/Users/sid.murching@databricks.com/otel-repro-test"

print("=" * 70)
print("OTel Tracing via MLflow API - Minimal Reproduction")
print("=" * 70)

# Timeout helper for the API call
class TimeoutException(Exception):
    pass

@contextmanager
def timeout(seconds):
    def signal_handler(signum, frame):
        raise TimeoutException(f"Operation timed out after {seconds}s")

    signal.signal(signal.SIGALRM, signal_handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)

# Step 1: Get OAuth token
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

# Step 2: Get SQL warehouse
print("\n📝 Step 2: Finding SQL warehouse...")

w = WorkspaceClient(profile=PROFILE)

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

print(f"✅ Using warehouse: {warehouse_name} ({warehouse_id})")

# Step 3: Use MLflow API to create tables
print("\n📝 Step 3: Using MLflow API to create UC tables...")
print(f"   Experiment: {EXPERIMENT_NAME}")
print(f"   UC Location: {CATALOG}.{SCHEMA}")
print(f"   This will create: {CATALOG}.{SCHEMA}.mlflow_experiment_trace_otel_*")

mlflow.set_tracking_uri("databricks")
os.environ["DATABRICKS_HOST"] = WORKSPACE_URL
os.environ["DATABRICKS_CONFIG_PROFILE"] = PROFILE
os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = warehouse_id

# Get or create experiment
if experiment := mlflow.get_experiment_by_name(EXPERIMENT_NAME):
    experiment_id = experiment.experiment_id
    print(f"✅ Found existing experiment: {experiment_id}")
else:
    experiment_id = mlflow.create_experiment(name=EXPERIMENT_NAME)
    print(f"✅ Created new experiment: {experiment_id}")

# Call set_experiment_trace_location with timeout
print("\n⏳ Calling set_experiment_trace_location() (may take up to 60s)...")
print("   This API will:")
print("   - Create mlflow_experiment_trace_otel_spans table")
print("   - Create mlflow_experiment_trace_otel_logs table")
print("   - Create mlflow_experiment_trace_otel_metrics table")

try:
    with timeout(60):
        result = set_experiment_trace_location(
            location=UCSchemaLocation(catalog_name=CATALOG, schema_name=SCHEMA),
            experiment_id=experiment_id,
        )

        uc_table = result.full_otel_spans_table_name
        print(f"\n✅ SUCCESS! Tables created:")
        print(f"   Spans: {result.full_otel_spans_table_name}")
        print(f"   Logs: {result.full_otel_logs_table_name}")
        print(f"   Metrics: {result.full_otel_metrics_table_name}")

except TimeoutException:
    print("\n⚠️  API call timed out after 60s")
    print("   Checking if tables were created anyway...")

    # Check if tables exist despite timeout
    uc_table = f"{CATALOG}.{SCHEMA}.mlflow_experiment_trace_otel_spans"
    try:
        table_info = w.tables.get(full_name=uc_table)
        print(f"✅ Table exists despite timeout: {table_info.name}")
        print("   Will proceed with test...")
    except Exception as e:
        print(f"❌ Table not found: {e}")
        print("   MLflow API failed to create tables")
        exit(1)

except Exception as e:
    print(f"\n⚠️  API call failed: {e}")
    print("   Checking if tables were created anyway...")

    # Check if tables exist despite error
    uc_table = f"{CATALOG}.{SCHEMA}.mlflow_experiment_trace_otel_spans"
    try:
        table_info = w.tables.get(full_name=uc_table)
        print(f"✅ Table exists despite error: {table_info.name}")
        print("   Will proceed with test...")
    except Exception as e2:
        print(f"❌ Table not found: {e2}")
        print("   MLflow API failed to create tables")
        exit(1)

# Step 4: Verify table schema
print("\n📝 Step 4: Verifying table schema...")
try:
    table_info = w.tables.get(full_name=uc_table)
    print(f"✅ Table: {table_info.name}")
    print(f"   Created: {table_info.created_at}")
    print(f"   Columns: {len(table_info.columns or [])} (should be 20+ for full OTel v1 schema)")

    # Check for key fields
    col_names = [col.name for col in (table_info.columns or [])]
    required_fields = ["flags", "dropped_attributes_count", "events", "links"]
    missing = [f for f in required_fields if f not in col_names]

    if missing:
        print(f"⚠️  Missing optional fields: {missing}")
        print("   OTel collector may reject writes due to schema validation")
    else:
        print("✅ All required fields present")

except Exception as e:
    print(f"❌ Error checking table: {e}")

# Step 5: Configure OTel exporter
print("\n📝 Step 5: Configuring OTel exporter...")

endpoint = f"{WORKSPACE_URL}/api/2.0/otel/v1/traces"

print(f"   Endpoint: {endpoint}")
print(f"   UC Table: {uc_table}")
print(f"   Experiment: {experiment_id}")
print(f"   Auth: OAuth token")

resource = Resource.create({
    "service.name": "otel-mlflow-api-test",
    "mlflow.experimentId": str(experiment_id),
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

# Step 6: Create and export test span
print("\n📝 Step 6: Creating and exporting test span...")

test_span_name = "otel-mlflow-api-test-span"
test_timestamp = time.time()

with tracer.start_as_current_span(test_span_name) as span:
    span.set_attribute("test.timestamp", str(test_timestamp))
    span.set_attribute("test.method", "mlflow-api")
    span.set_attribute("test.experiment_id", str(experiment_id))

print(f"✅ Span created: {test_span_name}")

print("\n📝 Step 7: Flushing spans to OTel collector...")
provider.force_flush()
print("✅ Flush completed (no client-side errors)")

# Step 8: Wait and check if trace appeared
print("\n📝 Step 8: Waiting 20 seconds for OTel collector to write to UC...")
time.sleep(20)

print("\n📝 Step 9: Querying UC table for trace...")

query_sql = f"""
SELECT trace_id, span_id, name, start_time_unix_nano
FROM {uc_table}
WHERE name = '{test_span_name}'
LIMIT 1
"""

try:
    result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=query_sql,
        wait_timeout="60s"
    )

    status = result.status.state.value if result.status and result.status.state else "UNKNOWN"
    print(f"   Query status: {status}")

    if status == "SUCCEEDED":
        if result.result and result.result.data_array and len(result.result.data_array) > 0:
            print("\n✅ SUCCESS! Trace found in UC table:")
            row = result.result.data_array[0]
            print(f"   Trace ID: {row[0]}")
            print(f"   Span ID: {row[1]}")
            print(f"   Name: {row[2]}")
            print(f"   Timestamp: {row[3]}")
            print("\n🎉 OTel tracing to Unity Catalog is WORKING!")
            print("\nThis means:")
            print("- MLflow API successfully created tables")
            print("- OTel collector can write to UC")
            print("- Public preview is functional in this workspace")
        else:
            print("\n❌ ISSUE REPRODUCED: Trace NOT found in UC table")
            print("\n   Even though:")
            print("   - Tables created via MLflow API")
            print("   - OTel export completed without errors")
            print("   - OAuth token used")
            print("   - Experiment linked to UC schema")

            # Check total row count
            count_sql = f"SELECT COUNT(*) FROM {uc_table}"
            try:
                count_result = w.statement_execution.execute_statement(
                    warehouse_id=warehouse_id,
                    statement=count_sql,
                    wait_timeout="60s"
                )
                if count_result.status.state.value == "SUCCEEDED" and count_result.result.data_array:
                    count = count_result.result.data_array[0][0]
                    print(f"\n   Total rows in table: {count}")
            except:
                pass

            print("\n   Possible causes:")
            print("   - OTel collector backend issue")
            print("   - S3 storage permission problem")
            print("   - Public preview not fully enabled")
    else:
        error_msg = result.status.error.message if result.status and result.status.error else "Unknown"
        print(f"\n❌ Query failed: {error_msg[:500]}")

        if "NOT_FOUND" in error_msg or "Incomplete complex type" in error_msg:
            print("\n   Table schema or storage issues detected:")
            print("   - Table may have schema problems")
            print("   - Or S3 storage permission issues")

except Exception as e:
    print(f"\n❌ Error querying table: {e}")

print("\n" + "=" * 70)
print("Reproduction script complete")
print("=" * 70)

# Cleanup instructions
print(f"\nCleanup:")
print(f"  # Drop tables:")
print(f"  DROP TABLE {CATALOG}.{SCHEMA}.mlflow_experiment_trace_otel_spans;")
print(f"  DROP TABLE {CATALOG}.{SCHEMA}.mlflow_experiment_trace_otel_logs;")
print(f"  DROP TABLE {CATALOG}.{SCHEMA}.mlflow_experiment_trace_otel_metrics;")
print(f"  # Delete experiment:")
print(f"  mlflow.delete_experiment('{experiment_id}')")
