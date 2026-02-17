# OTel Tracing Issue - Reproduction Scripts

## Issue Summary

Traces are **not being written to Unity Catalog** even with correct OTel configuration, authentication, and table schema.

## Two Reproduction Scripts

We have **two scripts** that demonstrate **different aspects** of the problem:

### 1. Manual Table Creation (Recommended First)
**File:** `repro-otel-tracing-issue.py`

Creates tables manually with SQL, demonstrates S3 storage issues.

```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http databricks-sdk
databricks auth login --profile dogfood
python scripts/repro-otel-tracing-issue.py
```

**Shows:**
- ✅ Tables are queryable
- ❌ Traces don't appear (S3 "NOT_FOUND" errors)
- ❌ Backend storage permission problem

### 2. MLflow API Creation
**File:** `repro-otel-with-mlflow-api.py`

Uses official `set_experiment_trace_location()` API, demonstrates API issues.

```bash
pip install 'mlflow[databricks]>=3.9.0' opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http databricks-sdk
databricks auth login --profile dogfood
python scripts/repro-otel-with-mlflow-api.py
```

**Shows:**
- ❌ API times out (60s)
- ❌ Tables have "Incomplete complex type" errors
- ❌ Tables not queryable despite correct schema

## Expected Output

### Script 1 (Manual Tables):
```
✅ Got OAuth token (expires in 3600s)
✅ Table created: main.agent_traces.otel_repro_test
✅ OTel exporter configured
✅ Span created: otel-repro-test-span
✅ Flush completed (no client-side errors)
❌ Query failed: NOT_FOUND: Not Found () at file-scan-node-base.cc:455
   → S3 storage permission issue
```

### Script 2 (MLflow API):
```
✅ Got OAuth token
✅ Created experiment
⚠️  API call timed out after 60s
✅ Table exists despite timeout
✅ All required fields present
✅ Flush completed (no client-side errors)
❌ Query failed: Incomplete complex type
   → MLflow API creates broken tables
```

## What the Script Tests

1. **Authentication** - Uses OAuth token from `databricks auth token` (NOT PAT)
2. **Table Schema** - Creates table with complete OTel v1 schema (20+ fields)
3. **OTel Export** - Sends span using official Python OTel SDK
4. **Verification** - Queries UC table to check if trace appeared

## Key Findings

### ✅ What Works

- OAuth token authentication (PAT tokens cause 401 errors)
- OTel collector accepts the request (HTTP 200)
- Client-side export completes without errors
- Table creation with full schema succeeds

### ❌ What Fails

- **Traces never appear in UC table**
- Query fails with: `NOT_FOUND: Not Found () at file-scan-node-base.cc:455`
- This suggests **S3 storage permission issues**

## Root Cause

The OTel collector backend cannot write Parquet files to the S3 bucket backing the Unity Catalog table.

**Evidence:**
- Table exists in UC metastore
- OTel export succeeds client-side
- But no data files in S3
- Queries fail with S3 "NOT_FOUND" errors

## Schema Validation

⚠️ The OTel collector **validates table schema** before writing. If you use a simplified schema (missing optional fields), you'll get:

```
ERROR: Schema validation error:
  Field "flags" found in proto but not in table schema
  Field "dropped_attributes_count" found in proto but not in table schema
  Field "events" found in proto but not in table schema
  ...
```

The repro script creates a table with the **full OTel v1 schema** to avoid this issue.

## Authentication Note

**CRITICAL:** The OTel collector requires **OAuth tokens**, not PAT tokens.

```python
# ✅ CORRECT - OAuth token
token = subprocess.run(["databricks", "auth", "token", "--profile", "dogfood"])

# ❌ WRONG - PAT token (causes 401 errors)
token = os.environ["DATABRICKS_TOKEN"]
```

## Which Script to Use

**For OTel Collector / Backend Team:**
- Use **Script 1** (manual tables)
- Shows S3 storage permission issues
- Tables are queryable, easy to debug

**For MLflow API Team:**
- Use **Script 2** (MLflow API)
- Shows API timeout and schema issues
- Demonstrates `set_experiment_trace_location()` problems

**For Complete Picture:**
- Share **both scripts** + this README
- Shows that multiple things are broken
- Backend storage + MLflow API both have issues

## What to Share with Team

Share this entire directory:
1. `repro-otel-tracing-issue.py` - Manual table creation (backend issue)
2. `repro-otel-with-mlflow-api.py` - MLflow API (API issue)
3. `REPRO_README.md` - This file
4. `../TRACING_STATUS.md` - Complete investigation report

## Questions for OTel Team

1. **S3 Permissions**: Does the OTel collector have write permissions to the S3 bucket backing `main.agent_traces.*` tables?

2. **Public Preview Status**: Is "OpenTelemetry on Databricks" public preview fully enabled in dogfood workspace?

3. **Schema Validation**: Why does the collector require ALL optional fields (flags, dropped_*_count, events, links)?

4. **Silent Failures**: Should clients receive errors when backend writes fail, or is silent failure expected?

5. **MLflow API Issues**: Why does `set_experiment_trace_location()` create tables with "Incomplete complex type" errors?

## Expected Behavior

When working correctly:
1. Client exports span → HTTP 200
2. OTel collector receives span
3. Collector validates schema → passes
4. Collector writes to S3 → succeeds
5. UC table query → returns trace data

## Current Behavior

1. Client exports span → HTTP 200 ✅
2. OTel collector receives span ✅
3. Collector validates schema → passes ✅
4. Collector writes to S3 → **FAILS** ❌
5. UC table query → "NOT_FOUND" error ❌

## Environment

- **Workspace**: e2-dogfood.staging.cloud.databricks.com
- **Profile**: dogfood
- **Experiment**: 2610606164206831
- **Region**: us-west-2
- **Catalog**: main
- **Schema**: agent_traces

## Cleanup

```sql
DROP TABLE main.agent_traces.otel_repro_test;
```
