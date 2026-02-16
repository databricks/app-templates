# MLflow Tracing Fix Summary

## Problem

Your coworker Hubert reported:
1. "Tracing setup in local dev does not work out OOTB despite providing experiment ID etc."
2. "Even after deploying the app and linking via the experiment resource, I can't seem to have traces logged"

Investigation revealed that **no traces were being exported to MLflow**, despite the code appearing to work correctly.

## Root Cause

The application was trying to use the wrong OpenTelemetry endpoint. Databricks has a **preview feature called "OTel Collector"** that requires:

1. **Different endpoint format**: `/api/2.0/otel/v1/traces` instead of `/v1/traces`
2. **Specific headers**:
   - `content-type: application/x-protobuf`
   - `X-Databricks-UC-Table-Name` pointing to a Unity Catalog table
   - `Authorization: Bearer <token>`
3. **Unity Catalog tables** for storing traces (not MLflow's internal storage)
4. **OTel collector preview** must be enabled in your workspace

## Changes Made

### 1. Updated Tracing Endpoint (`src/tracing.ts`)
- Changed from `/v1/traces` → `/api/2.0/otel/v1/traces`
- Added required `content-type: application/x-protobuf` header
- Added `X-Databricks-UC-Table-Name` header support

### 2. Environment Configuration
- Added `OTEL_UC_TABLE_NAME` variable to `.env.example`
- Updated `.env` with TODO placeholder
- Documented the required format: `<catalog>.<schema>.<prefix>_otel_spans`

### 3. Documentation
- Created comprehensive setup guide: `docs/OTEL_SETUP.md`
- Includes step-by-step instructions for:
  - Enabling OTel collector preview
  - Creating Unity Catalog tables
  - Granting permissions
  - Testing and verifying traces

### 4. Regression Tests
- Added test to verify correct OTel endpoint format
- All 12 tracing tests passing
- Tests verify endpoint is `/api/2.0/otel/v1/traces`

## What You Need to Do Next

### Step 1: Enable OTel Collector Preview

1. Go to your Databricks workspace Admin Console
2. Navigate to Preview Features
3. Enable "OTel Collector"
4. Wait a few minutes for activation

### Step 2: Create Unity Catalog Tables

Run this SQL in your workspace (adjust catalog/schema as needed):

```sql
-- Create schema for traces
CREATE CATALOG IF NOT EXISTS main;
CREATE SCHEMA IF NOT EXISTS main.agent_traces;

-- Create spans table
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
```

### Step 3: Grant Permissions

**IMPORTANT**: You must grant `MODIFY` and `SELECT` explicitly (not `ALL_PRIVILEGES`):

```sql
-- Replace with your user email or service principal
GRANT USE_CATALOG ON CATALOG main TO `your-user@email.com`;
GRANT USE_SCHEMA ON SCHEMA main.agent_traces TO `your-user@email.com`;
GRANT MODIFY, SELECT ON TABLE main.agent_traces.otel_spans TO `your-user@email.com`;
```

### Step 4: Configure Environment

Update your `.env` file:

```bash
# Add this line (replace with your actual table name)
OTEL_UC_TABLE_NAME=main.agent_traces.otel_spans
```

### Step 5: Test Locally

```bash
# Start agent
npm run dev:agent

# In another terminal, send test request
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

Check the logs for:
```
📊 Traces will be stored in UC table: main.agent_traces.otel_spans
✅ MLflow tracing initialized
```

### Step 6: Verify Traces in UC

Query the table to see traces:

```sql
SELECT
  trace_id,
  name,
  start_time,
  end_time,
  attributes
FROM main.agent_traces.otel_spans
ORDER BY start_time DESC
LIMIT 10;
```

### Step 7: Update databricks.yml (For Deployment)

Add the UC table as a resource:

```yaml
resources:
  apps:
    agent_langchain_ts:
      resources:
        # Existing resources...

        # Add these for tracing
        - name: agent-traces-schema
          schema:
            schema_name: main.agent_traces
            permission: USE_SCHEMA

        - name: otel-spans-table
          table:
            table_name: main.agent_traces.otel_spans
            permission: MODIFY
```

### Step 8: Deploy and Test

```bash
# Build and deploy
npm run build
databricks bundle deploy
databricks bundle run agent_langchain_ts

# Get app URL and test
APP_URL=$(databricks apps get agent-lc-ts-dev --output json | jq -r '.url')
TOKEN=$(databricks auth token --profile dogfood | jq -r '.access_token')

curl -X POST "$APP_URL/invocations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "What time is it?"}],
    "stream": false
  }'

# Check for new traces in UC table
```

## Architecture Diagram

```
┌─────────────────┐
│  TypeScript     │
│  Agent          │
│  (OpenTelemetry)│
└────────┬────────┘
         │
         │ OTLP/HTTP (protobuf)
         │ + Headers:
         │   - content-type: application/x-protobuf
         │   - X-Databricks-UC-Table-Name
         │   - Authorization: Bearer <token>
         ▼
┌─────────────────────────────┐
│ Databricks OTel Collector   │
│ /api/2.0/otel/v1/traces     │
│ (Preview Feature)           │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Unity Catalog Tables        │
│ main.agent_traces.otel_*    │
│  - otel_spans               │
│  - otel_logs (optional)     │
│  - otel_metrics (optional)  │
└─────────────────────────────┘
```

## Key Differences from Before

| Aspect | Before | After |
|--------|--------|-------|
| Endpoint | `/v1/traces` | `/api/2.0/otel/v1/traces` |
| Storage | MLflow internal | Unity Catalog tables |
| Headers | Basic auth only | Protobuf + UC table name + auth |
| Setup | None required | Preview + UC tables + permissions |
| Viewing | MLflow UI | SQL queries on UC tables |

## Verification Checklist

- [ ] OTel collector preview enabled in workspace
- [ ] Unity Catalog tables created (`main.agent_traces.otel_spans`)
- [ ] Permissions granted (`MODIFY` + `SELECT`, not `ALL_PRIVILEGES`)
- [ ] `OTEL_UC_TABLE_NAME` set in `.env`
- [ ] Local test shows "📊 Traces will be stored in UC table" log
- [ ] SQL query returns traces after test request
- [ ] `databricks.yml` includes UC table resources
- [ ] Deployed app shows traces in UC table

## Troubleshooting

### No traces appearing

Check:
1. OTel preview enabled? (Admin Console → Preview Features)
2. UC table exists? `SHOW TABLES IN main.agent_traces;`
3. Permissions correct? `GRANT MODIFY, SELECT` (not `ALL_PRIVILEGES`)
4. `OTEL_UC_TABLE_NAME` set correctly in `.env`?
5. Agent logs show "📊 Traces will be stored in UC table"?

### Permission denied errors

Solution: Grant explicit `MODIFY` and `SELECT` (not `ALL_PRIVILEGES`):
```sql
GRANT MODIFY, SELECT ON TABLE main.agent_traces.otel_spans TO `your-user@email.com`;
```

### "No auth token available" warning

Solutions (in order of preference):
1. Set `DATABRICKS_TOKEN` in `.env`
2. Set `DATABRICKS_CONFIG_PROFILE` to use Databricks CLI
3. Set `DATABRICKS_CLIENT_ID` + `DATABRICKS_CLIENT_SECRET` for OAuth2

## Additional Resources

- Full setup guide: `docs/OTEL_SETUP.md`
- Databricks OTel docs: https://docs.databricks.com/api/2.0/otel/
- OpenTelemetry docs: https://opentelemetry.io/docs/

## Testing

All tracing tests pass (12/12):
```bash
npx jest tests/tracing.test.ts
```

Key test validates correct endpoint format:
```javascript
expect(traceConfigLog![1].url).toContain('/api/2.0/otel/v1/traces');
```

---

**Status**: Code changes complete, ready for setup
**Next Step**: Enable OTel collector preview and create UC tables
**Estimated Setup Time**: 15-20 minutes

---

Let me know if you hit any issues during setup!
