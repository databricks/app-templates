#!/usr/bin/env python3
"""
Setup OTel tracing using public preview MLflow API.
Based on official Databricks documentation for OpenTelemetry public preview.
"""

import os
import mlflow
from mlflow.exceptions import MlflowException
from mlflow.entities import UCSchemaLocation
from mlflow.tracing.enablement import set_experiment_trace_location

# Get SQL warehouse ID
from databricks.sdk import WorkspaceClient
w = WorkspaceClient(profile="dogfood")

warehouses = w.warehouses.list()
warehouse_id = None
for wh in warehouses:
    if wh.state and wh.state.value == "RUNNING":
        warehouse_id = wh.id
        warehouse_name = wh.name
        break

print("=" * 60)
print("MLflow OTel Tracing Setup (Public Preview)")
print("=" * 60)
print(f"\n📊 SQL Warehouse: {warehouse_name} ({warehouse_id})")

mlflow.set_tracking_uri("databricks")

# Set up authentication
os.environ["DATABRICKS_HOST"] = "https://e2-dogfood.staging.cloud.databricks.com"
os.environ["DATABRICKS_CONFIG_PROFILE"] = "dogfood"

# Set SQL warehouse ID for trace logging
os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = warehouse_id

# Configuration
experiment_name = "/Users/sid.murching@databricks.com/agent-langchain-ts"
catalog_name = "main"
schema_name = "agent_traces"

print(f"\n📝 Configuration:")
print(f"   Experiment: {experiment_name}")
print(f"   Catalog: {catalog_name}")
print(f"   Schema: {schema_name}")

# Get or create experiment
if experiment := mlflow.get_experiment_by_name(experiment_name):
    experiment_id = experiment.experiment_id
    print(f"\n✅ Found existing experiment: {experiment_id}")
else:
    experiment_id = mlflow.create_experiment(name=experiment_name)
    print(f"\n✅ Created new experiment: {experiment_id}")

# Link experiment to UC trace location
print(f"\n🔗 Linking experiment to Unity Catalog schema...")
print(f"   This will auto-create the required tables:")
print(f"   - {catalog_name}.{schema_name}.mlflow_experiment_trace_otel_spans")
print(f"   - {catalog_name}.{schema_name}.mlflow_experiment_trace_otel_logs")
print(f"   - {catalog_name}.{schema_name}.mlflow_experiment_trace_otel_metrics")

try:
    result = set_experiment_trace_location(
        location=UCSchemaLocation(catalog_name=catalog_name, schema_name=schema_name),
        experiment_id=experiment_id,
    )

    print(f"\n✅ SUCCESS! Trace location configured")
    print(f"   Spans table: {result.full_otel_spans_table_name}")
    print(f"   Logs table: {result.full_otel_logs_table_name}")
    print(f"   Metrics table: {result.full_otel_metrics_table_name}")

    print("\n📝 Update your .env file:")
    print(f"   MLFLOW_EXPERIMENT_ID={experiment_id}")
    print(f"   MLFLOW_TRACING_SQL_WAREHOUSE_ID={warehouse_id}")
    print(f"   OTEL_UC_TABLE_NAME={result.full_otel_spans_table_name}")

    print("\n✅ Setup complete! Ready to trace.")

except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()
    print("\nTroubleshooting:")
    print("1. Ensure 'OpenTelemetry on Databricks' preview is enabled")
    print("2. Check you have permissions to create tables in UC")
    print("3. Verify workspace is in us-west-2 or us-east-1")
