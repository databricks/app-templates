# Databricks OTel Collector Setup Guide

This guide walks you through enabling MLflow tracing for your TypeScript agent using the Databricks OpenTelemetry (OTel) Collector preview feature.

## Overview

The Databricks OTel Collector allows you to export traces directly to Unity Catalog tables, where they can be viewed, analyzed, and used for monitoring your agent's behavior.

## Prerequisites

- Databricks workspace with OTel collector preview enabled
- Unity Catalog access
- Databricks CLI configured

## Setup Steps

### 1. Enable OTel Collector Preview

1. Go to your Databricks workspace Admin Console
2. Navigate to the Preview Features section
3. Enable the **OTel Collector** preview
4. Wait a few minutes for the feature to be activated

### 2. Create Unity Catalog Tables

Run these SQL queries in your Databricks SQL workspace to create the required tables:

```sql
-- Create catalog and schema (if not exists)
CREATE CATALOG IF NOT EXISTS main;
CREATE SCHEMA IF NOT EXISTS main.agent_traces;

-- Create spans table for trace data
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
)
USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');

-- Create logs table (optional, for log export)
CREATE TABLE IF NOT EXISTS main.agent_traces.otel_logs (
  timestamp TIMESTAMP,
  severity_text STRING,
  severity_number INT,
  body STRING,
  attributes MAP<STRING, STRING>,
  resource_attributes MAP<STRING, STRING>,
  trace_id STRING,
  span_id STRING
)
USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');

-- Create metrics table (optional, for metrics export)
CREATE TABLE IF NOT EXISTS main.agent_traces.otel_metrics (
  timestamp TIMESTAMP,
  name STRING,
  description STRING,
  unit STRING,
  type STRING,
  value DOUBLE,
  attributes MAP<STRING, STRING>,
  resource_attributes MAP<STRING, STRING>
)
USING DELTA
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');
```

### 3. Generate Authentication Token

Generate a Databricks personal access token with permissions to write to the Unity Catalog tables:

```bash
# Using Databricks CLI
databricks auth token --profile your-profile

# Or generate manually in workspace:
# User Settings → Access Tokens → Generate New Token
```

### 4. Grant Table Permissions

Grant the required permissions to your auth token's user/service principal:

```sql
-- Grant catalog permissions
GRANT USE_CATALOG ON CATALOG main TO `your-user@email.com`;

-- Grant schema permissions
GRANT USE_SCHEMA ON SCHEMA main.agent_traces TO `your-user@email.com`;

-- Grant table permissions (MODIFY + SELECT required, not ALL_PRIVILEGES)
GRANT MODIFY, SELECT ON TABLE main.agent_traces.otel_spans TO `your-user@email.com`;
GRANT MODIFY, SELECT ON TABLE main.agent_traces.otel_logs TO `your-user@email.com`;
GRANT MODIFY, SELECT ON TABLE main.agent_traces.otel_metrics TO `your-user@email.com`;
```

**Important:** You must grant `MODIFY` and `SELECT` explicitly. Using `ALL_PRIVILEGES` is not sufficient due to a known issue.

### 5. Configure Environment Variables

Update your `.env` file with the OTel configuration:

```bash
# Databricks Authentication
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=dapi...  # From step 3

# MLflow Tracing
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_ID=your-experiment-id

# OTel Collector Configuration
OTEL_UC_TABLE_NAME=main.agent_traces.otel_spans
```

### 6. Test Locally

Start your agent and send a test request:

```bash
# Terminal 1: Start agent
npm run dev:agent

# Terminal 2: Send test request
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "What time is it in Tokyo?"}],
    "stream": false
  }'
```

Check the agent logs for:
```
📊 Traces will be stored in UC table: main.agent_traces.otel_spans
✅ MLflow tracing initialized
```

### 7. Verify Traces in Unity Catalog

Query the traces table to verify traces are being written:

```sql
SELECT
  trace_id,
  name,
  start_time,
  end_time,
  DATEDIFF(second, start_time, end_time) as duration_seconds,
  attributes
FROM main.agent_traces.otel_spans
ORDER BY start_time DESC
LIMIT 10;
```

### 8. Deploy to Databricks

Update your `databricks.yml` to include the UC table resources:

```yaml
resources:
  apps:
    agent_langchain_ts:
      resources:
        # Grant access to the trace table
        - name: otel-spans-table
          table:
            table_name: main.agent_traces.otel_spans
            permission: MODIFY

        # Grant schema access
        - name: agent-traces-schema
          schema:
            schema_name: main.agent_traces
            permission: USE_SCHEMA
```

Deploy the app:

```bash
npm run build
databricks bundle deploy
databricks bundle run agent_langchain_ts
```

## OTel Endpoints

The Databricks OTel collector provides these endpoints:

- **Traces**: `https://{workspace}/api/2.0/otel/v1/traces`
- **Logs**: `https://{workspace}/api/2.0/otel/v1/logs`
- **Metrics**: `https://{workspace}/api/2.0/otel/v1/metrics`

## Required Headers

All requests to the OTel collector must include:

| Header | Value | Description |
|--------|-------|-------------|
| `content-type` | `application/x-protobuf` | Protocol buffer format |
| `X-Databricks-UC-Table-Name` | `<catalog>.<schema>.<table>` | Target UC table |
| `Authorization` | `Bearer <token>` | Authentication token |

## Troubleshooting

### No traces appearing in UC table

1. **Check OTel preview is enabled**: Admin Console → Preview Features
2. **Verify table permissions**: Ensure `MODIFY` and `SELECT` are granted (not just `ALL_PRIVILEGES`)
3. **Check authentication**: Verify `DATABRICKS_TOKEN` is set and valid
4. **Check table name**: Ensure `OTEL_UC_TABLE_NAME` matches the actual table name
5. **Check agent logs**: Look for errors or warnings about trace export

### Permission denied errors

```
Error: PERMISSION_DENIED: User does not have MODIFY permission on table
```

**Solution**: Grant explicit `MODIFY` and `SELECT` permissions (not `ALL_PRIVILEGES`):
```sql
GRANT MODIFY, SELECT ON TABLE main.agent_traces.otel_spans TO `your-user@email.com`;
```

### Authentication errors

```
⚠️  No auth token available for trace export
```

**Solution**: Ensure one of these is set:
- `DATABRICKS_TOKEN` environment variable
- `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` for OAuth2
- `DATABRICKS_CONFIG_PROFILE` with valid Databricks CLI profile

### Traces not showing in MLflow UI

The OTel collector writes traces to Unity Catalog tables, not directly to MLflow experiments. To view traces:

1. **Query UC tables directly**:
   ```sql
   SELECT * FROM main.agent_traces.otel_spans ORDER BY start_time DESC;
   ```

2. **Use MLflow integration** (coming soon):
   MLflow will soon support reading traces from UC tables for visualization.

## Architecture

```
┌─────────────────┐
│  TypeScript     │
│  Agent          │
│  (OpenTelemetry)│
└────────┬────────┘
         │
         │ OTLP/HTTP (protobuf)
         ▼
┌─────────────────────────────┐
│ Databricks OTel Collector   │
│ /api/2.0/otel/v1/traces     │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Unity Catalog Tables        │
│ main.agent_traces.otel_*    │
│  - otel_spans               │
│  - otel_logs                │
│  - otel_metrics             │
└─────────────────────────────┘
```

## Additional Resources

- [Databricks OTel Collector Documentation](https://docs.databricks.com/api/2.0/otel/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [MLflow Tracing](https://mlflow.org/docs/latest/llms/tracing/)
- [Unity Catalog Permissions](https://docs.databricks.com/en/data-governance/unity-catalog/manage-privileges/privileges.html)

## FAQ

**Q: Do I need to use MLflow experiments anymore?**
A: The `MLFLOW_EXPERIMENT_ID` is still useful for organizing traces, but traces are now stored in UC tables instead of MLflow's internal storage.

**Q: Can I use this with local MLflow?**
A: No, the OTel collector is a Databricks-hosted service. For local development, you can still use the Databricks OTel collector if you have network access to your workspace.

**Q: What about existing traces in MLflow?**
A: Existing traces in MLflow experiments will remain there. New traces will be written to UC tables.

**Q: How do I migrate to the OTel collector?**
A: Just follow this setup guide. The agent code handles both old and new tracing methods automatically based on the endpoint URL.

---

**Last Updated**: 2026-02-13
