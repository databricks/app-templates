# OTel Public Preview Setup

Based on official Databricks "OpenTelemetry on Databricks" public preview documentation.

## Key Differences from Private Preview

### 1. Use MLflow API (Not Manual SQL)

❌ **Old way (private preview):**
```sql
CREATE TABLE main.agent_traces.otel_spans (...)
```

✅ **New way (public preview):**
```python
from mlflow.tracing.enablement import set_experiment_trace_location
from mlflow.entities import UCSchemaLocation

result = set_experiment_trace_location(
    location=UCSchemaLocation(catalog_name="main", schema_name="agent_traces"),
    experiment_id=experiment_id,
)
```

This automatically creates tables with correct schema and names.

### 2. Table Names are Auto-Generated

The tables created are:
- `mlflow_experiment_trace_otel_spans`
- `mlflow_experiment_trace_otel_logs`
- `mlflow_experiment_trace_otel_metrics`

NOT `otel_spans` or `langchain_otel_spans`!

### 3. Requires SQL Warehouse ID

Set in environment:
```python
os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = "your-warehouse-id"
```

## Setup Steps

### Step 1: Install MLflow 3.9.0+

```bash
pip install 'mlflow[databricks]>=3.9.0' --upgrade
```

### Step 2: Run Setup Script

```python
import os
import mlflow
from mlflow.entities import UCSchemaLocation
from mlflow.tracing.enablement import set_experiment_trace_location

# Configure
mlflow.set_tracking_uri("databricks")
os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = "your-warehouse-id"

experiment_name = "/Users/user@company.com/my-experiment"
catalog_name = "main"
schema_name = "agent_traces"

# Get or create experiment
if experiment := mlflow.get_experiment_by_name(experiment_name):
    experiment_id = experiment.experiment_id
else:
    experiment_id = mlflow.create_experiment(name=experiment_name)

# Link experiment to UC schema (creates tables automatically)
result = set_experiment_trace_location(
    location=UCSchemaLocation(catalog_name=catalog_name, schema_name=schema_name),
    experiment_id=experiment_id,
)

print(f"Spans table: {result.full_otel_spans_table_name}")
# Prints: main.agent_traces.mlflow_experiment_trace_otel_spans
```

### Step 3: Grant Permissions

```sql
-- Your user needs these permissions
GRANT USE_CATALOG ON CATALOG main TO `user@company.com`;
GRANT USE_SCHEMA ON SCHEMA main.agent_traces TO `user@company.com`;
GRANT MODIFY, SELECT ON TABLE main.agent_traces.mlflow_experiment_trace_otel_spans TO `user@company.com`;
GRANT MODIFY, SELECT ON TABLE main.agent_traces.mlflow_experiment_trace_otel_logs TO `user@company.com`;
GRANT MODIFY, SELECT ON TABLE main.agent_traces.mlflow_experiment_trace_otel_metrics TO `user@company.com`;
```

**Important:** `ALL_PRIVILEGES` is NOT sufficient! Must explicitly grant MODIFY and SELECT.

### Step 4: Configure Agent

Update `.env`:
```bash
MLFLOW_EXPERIMENT_ID=your-experiment-id
MLFLOW_TRACING_SQL_WAREHOUSE_ID=your-warehouse-id
OTEL_UC_TABLE_NAME=main.agent_traces.mlflow_experiment_trace_otel_spans
```

### Step 5: Test with Python OTEL Client

```python
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

otlp_trace_exporter = OTLPSpanExporter(
    endpoint="https://myworkspace.databricks.com/api/2.0/otel/v1/traces",
    headers={
        "content-type": "application/x-protobuf",
        "X-Databricks-UC-Table-Name": "main.agent_traces.mlflow_experiment_trace_otel_spans",
        "Authorization": f"Bearer {token}"
    },
)
```

## Prerequisites

1. ✅ Unity Catalog-enabled workspace
2. ✅ "OpenTelemetry on Databricks" preview enabled (Admin → Previews)
3. ✅ Workspace in us-west-2 or us-east-1 (beta limitation)
4. ✅ SQL warehouse with CAN USE permissions
5. ✅ Permissions to create tables in UC

## Permissions Model

**Public Preview uses YOUR token, not a service principal:**

1. Your OTel client sends traces with YOUR auth token
2. Databricks OTel collector receives traces
3. Collector writes to UC tables **using YOUR token**
4. Therefore, **YOU need MODIFY + SELECT** on the UC tables

This is different from private preview where a shared service principal might write.

## Troubleshooting

### "401: Credential was not sent"
- Set `DATABRICKS_CONFIG_PROFILE` environment variable
- Or set `DATABRICKS_HOST` and `DATABRICKS_TOKEN`

### "Permission denied" on table writes
- Ensure you have `MODIFY` and `SELECT` (not just `ALL_PRIVILEGES`)
- Check storage credential permissions if using external locations

### Tables not created
- Verify "OpenTelemetry on Databricks" preview is enabled
- Check workspace is in supported region (us-west-2, us-east-1)
- Ensure SQL warehouse ID is correct and accessible

### Traces not appearing
1. **Check table exists:**
   ```sql
   SHOW TABLES IN main.agent_traces LIKE 'mlflow_experiment_trace_otel_%';
   ```

2. **Check permissions:**
   ```sql
   SHOW GRANTS ON TABLE main.agent_traces.mlflow_experiment_trace_otel_spans;
   ```

3. **Check table name in header matches exactly:**
   ```python
   headers={"X-Databricks-UC-Table-Name": "main.agent_traces.mlflow_experiment_trace_otel_spans"}
   ```

4. **Query table directly:**
   ```sql
   SELECT COUNT(*) FROM main.agent_traces.mlflow_experiment_trace_otel_spans;
   ```

## Current Status

### For agent-langchain-ts:

1. ✅ Experiment exists: `/Users/sid.murching@databricks.com/agent-langchain-ts` (ID: 2610606164206831)
2. ✅ SQL Warehouse available: `000000000000000d`
3. ⏳ Running `set_experiment_trace_location()` to create tables
4. ⏳ Tables being created: `main.agent_traces.mlflow_experiment_trace_otel_*`

### Next Steps:

1. Wait for table creation to complete
2. Verify tables exist in Catalog Explorer
3. Grant MODIFY + SELECT permissions to `sid.murching@databricks.com`
4. Update `.env` with correct table name
5. Restart agent and test

## References

- Official docs: OpenTelemetry on Databricks (Beta)
- MLflow version: 3.9.0+
- API: `mlflow.tracing.enablement.set_experiment_trace_location`
