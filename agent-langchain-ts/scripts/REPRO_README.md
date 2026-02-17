# OTel Tracing Issue - Reproduction Script

## Issue Summary

Traces are **not being written to Unity Catalog** even with correct OTel configuration, authentication, and table schema.

## Quick Repro

```bash
# Install dependencies
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http databricks-sdk

# Authenticate
databricks auth login --profile dogfood

# Run repro script
python scripts/repro-otel-tracing-issue.py
```

## Expected Output

```
✅ Got OAuth token (expires in 3600s)
✅ Table created: main.agent_traces.otel_repro_test
✅ OTel exporter configured
✅ Span created: otel-repro-test-span
✅ Flush completed (no client-side errors)
⏳ Waiting 15 seconds for OTel collector to write to UC...
❌ ISSUE REPRODUCED: Trace NOT found in UC table
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

## What to Share with Team

Share this entire directory with:
1. `repro-otel-tracing-issue.py` - The reproduction script
2. `REPRO_README.md` - This file
3. `../TRACING_STATUS.md` - Complete investigation report

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
