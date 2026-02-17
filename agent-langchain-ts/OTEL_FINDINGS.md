# OTel Tracing Investigation - Findings

## Key Discovery: Table Schema Mismatch

**Root Cause**: The UC table schema we created didn't match the official OTel schema required by Databricks OTel collector.

### Schema Comparison

**What we created initially:**
```sql
CREATE TABLE otel_spans (
  trace_id STRING,
  span_id STRING,
  start_time TIMESTAMP,  -- ❌ Wrong type
  end_time TIMESTAMP,    -- ❌ Wrong type
  status_code STRING,    -- ❌ Wrong structure
  status_message STRING,
  ...
)
```

**Official OTel schema (from docs):**
```sql
CREATE TABLE otel_spans (
  trace_id STRING,
  span_id STRING,
  start_time_unix_nano LONG,  -- ✅ Correct
  end_time_unix_nano LONG,    -- ✅ Correct
  status STRUCT<              -- ✅ Correct structure
    message: STRING,
    code: STRING
  >,
  resource STRUCT<...>,       -- ✅ Required
  instrumentation_scope STRUCT<...>,  -- ✅ Required
  ...
)
```

## What We Fixed

1. ✅ **OTel Endpoint**: Changed to `/api/2.0/otel/v1/traces`
2. ✅ **Headers**: Added `content-type: application/x-protobuf` and `X-Databricks-UC-Table-Name`
3. ✅ **Authentication**: Configured `DATABRICKS_TOKEN` in `.env`
4. ✅ **Table Schema**: Created `main.agent_traces.langchain_otel_spans` with official schema
5. ✅ **Endpoint Verification**: Confirmed endpoint returns HTTP 200

## Current Status

### ✅ Working
- OTel collector endpoint is accessible
- Authentication is working (HTTP 200 response)
- Headers are correct format
- Table has official schema

### ❌ Not Working Yet
- **Traces not appearing in UC table**

## Likely Causes

### 1. OTel Collector Service Permissions (Most Likely)
The Databricks OTel collector is a service that needs explicit permissions to write to UC tables.

**Required setup** (from documentation):
```sql
-- Grant permissions to the OTel collector service principal
GRANT USE_CATALOG ON CATALOG main TO `<otel-service-principal>`;
GRANT USE_SCHEMA ON SCHEMA main.agent_traces TO `<otel-service-principal>`;
GRANT MODIFY, SELECT ON TABLE main.agent_traces.langchain_otel_spans TO `<otel-service-principal>`;
```

**Note**: The service principal name for the OTel collector needs to be provided by Databricks or configured during preview setup.

### 2. Preview Feature Not Fully Enabled
The OTel collector preview might need additional configuration beyond just enabling the toggle:
- Workspace-specific setup
- Service principal provisioning
- UC catalog allowlist

### 3. Protobuf Encoding Issues
The OTel libraries might not be encoding spans correctly for the Databricks collector.

## Verification Tests

### Test 1: Endpoint Accessibility ✅
```bash
curl -X POST 'https://e2-dogfood.staging.cloud.databricks.com/api/2.0/otel/v1/traces' \
  -H 'Content-Type: application/x-protobuf' \
  -H 'X-Databricks-UC-Table-Name: main.agent_traces.langchain_otel_spans' \
  -H 'Authorization: Bearer <token>'

Result: HTTP 200 ✅
```

### Test 2: Python OTel Simple Test ❌
```python
# Using official OpenTelemetry Python SDK
otlp_exporter = OTLPSpanExporter(
    endpoint=f"{WORKSPACE_URL}/api/2.0/otel/v1/traces",
    headers={
        "content-type": "application/x-protobuf",
        "X-Databricks-UC-Table-Name": UC_TABLE,
        "Authorization": f"Bearer {TOKEN}"
    },
)
# Creates and flushes spans
# Result: Spans created, but not in UC table ❌
```

### Test 3: TypeScript LangChain Agent ❌
```
Agent logs show spans being created:
- 📝 Span started: LangGraph
- 📝 Span started: ChatDatabricks
- 📝 Span started: calculator

Result: Spans created, but not in UC table ❌
```

## Next Steps

### Immediate Actions
1. **Check with Databricks team**: What service principal does the OTel collector use?
2. **Grant collector permissions**: Once service principal is known, grant UC table permissions
3. **Verify preview setup**: Ensure all preview setup steps were completed

### Debugging Steps
1. **Check OTel collector logs** (if accessible):
   - Are traces being received?
   - Any permission errors?
   - Any schema validation errors?

2. **Test with official Python example**:
   - Use exact example from docs
   - Verify with known-working workspace

3. **Contact Databricks support**:
   - Share workspace ID: `e2-dogfood.staging.cloud.databricks.com`
   - Share UC table: `main.agent_traces.langchain_otel_spans`
   - Ask about OTel collector service principal

## Files Created

1. `docs/OTEL_SETUP.md` - Complete setup guide
2. `TRACING_FIX_SUMMARY.md` - Quick reference
3. `scripts/create-table-simple.py` - Creates UC tables
4. `scripts/test-otel-simple.py` - Simple Python OTel test
5. `scripts/recreate-otel-table-correct-schema.py` - Recreates with official schema

## Table Info

- **Correct table**: `main.agent_traces.langchain_otel_spans`
- **Schema**: Official OTel v1 format
- **TBLPROPERTIES**: `'otel.schemaVersion' = 'v1'`

## Configuration

**.env settings:**
```bash
OTEL_UC_TABLE_NAME=main.agent_traces.langchain_otel_spans
DATABRICKS_TOKEN=<token-from-databricks-auth-token>
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_ID=2610606164206831
```

**Agent tracing configuration:**
- Endpoint: `https://e2-dogfood.staging.cloud.databricks.com/api/2.0/otel/v1/traces`
- Headers: `content-type: application/x-protobuf`, `X-Databricks-UC-Table-Name`
- Auth: Bearer token

## Summary

We've successfully configured the TypeScript agent to use the Databricks OTel collector with the correct endpoint, headers, and authentication. We created a UC table with the official OTel schema. The OTel endpoint is accessible and responding.

**The remaining issue is that traces aren't being written to the UC table**, most likely because the OTel collector service doesn't have permissions to write to the table. This requires coordination with Databricks to:
1. Identify the OTel collector service principal
2. Grant the necessary UC permissions
3. Verify the preview feature is fully configured

Once these permissions are in place, traces should start appearing in `main.agent_traces.langchain_otel_spans`.
