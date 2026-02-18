# MLflow Tracing to Unity Catalog - Complete Summary

## Problem Statement

The TypeScript LangChain agent needed to log traces to Unity Catalog via the Databricks OTel (OpenTelemetry) collector, but encountered several issues:

1. **OTel endpoints were unavailable** - Initial attempts returned 404 errors
2. **Schema compatibility issues** - Some SQL warehouses couldn't query the complex OTel schema
3. **Warehouse requirement question** - Why is a warehouse ID needed for automatic setup?

## Solutions Implemented

### 1. OAuth Token Requirement (✅ Fixed)

**Issue**: OTel collector rejects Personal Access Tokens (PAT tokens)

**Solution**: Implemented OAuth token retrieval from Databricks CLI

```typescript
// src/tracing.ts
private async getOAuthTokenFromCLI(): Promise<string | null> {
  const profile = process.env.DATABRICKS_CONFIG_PROFILE || "DEFAULT";
  const command = `databricks auth token --profile ${profile}`;
  const output = execSync(command, { encoding: 'utf-8' });
  const data = JSON.parse(output);
  return data.access_token;
}
```

**Priority**: OAuth from CLI > OAuth from client credentials > PAT token (with warning)

### 2. SQL Warehouse Compatibility (✅ Fixed)

**Issue**: Different SQL warehouses handle complex OTel schema types differently

**Discovery**: Warehouse `000000000000000d` returned "Incomplete complex type" errors, but warehouse `02c6ce260d0e8ffe` works correctly

**Solution**: Use warehouse ID `02c6ce260d0e8ffe` for setup and validation

**Configuration**:
- Local: `.env` → `MLFLOW_TRACING_SQL_WAREHOUSE_ID=02c6ce260d0e8ffe`
- Deployed: `app.yaml` → `MLFLOW_TRACING_SQL_WAREHOUSE_ID: "02c6ce260d0e8ffe"`

### 3. Automatic UC Setup (✅ Implemented)

**Implementation**: TypeScript equivalent of MLflow's `set_experiment_trace_location()` using REST APIs

**Two-step process**:

1. **Create UC location** (`POST /api/4.0/mlflow/traces/location`):
   ```typescript
   {
     uc_schema: { catalog_name, schema_name },
     sql_warehouse_id: warehouseId  // REQUIRED for table creation
   }
   ```

2. **Link experiment** (`POST /api/4.0/mlflow/traces/{experiment_id}/link-location`):
   ```typescript
   {
     experiment_id: experimentId,
     uc_schema: { catalog_name, schema_name }
     // NO warehouse_id needed here!
   }
   ```

### 4. Warehouse Requirement Clarification (✅ Improved)

## Why is a Warehouse Needed?

**TL;DR**: The warehouse is **ONLY needed for initial table creation**, not for linking or ongoing tracing.

### Detailed Explanation

The MLflow REST API `/api/4.0/mlflow/traces/location` **requires** `sql_warehouse_id` because it:
1. Creates the UC schema if it doesn't exist
2. Creates the `mlflow_experiment_trace_otel_spans` table with proper schema (complex nested types)
3. Sets up permissions

**However**, once the table exists, the link API works WITHOUT a warehouse!

### Code Improvements

**Before** (always required warehouse):
```typescript
if (!warehouseId) {
  console.warn("⚠️  MLFLOW_TRACING_SQL_WAREHOUSE_ID not set, skipping UC setup");
  return null;
}
```

**After** (gracefully handles missing warehouse):
```typescript
if (!warehouseId) {
  console.log(`⚠️  MLFLOW_TRACING_SQL_WAREHOUSE_ID not set`);
  console.log(`   Attempting to link to existing table: ${tableName}`);
  return await this.linkExperimentToLocation(catalogName, schemaName, tableName);
}
```

**New helper method**:
```typescript
/**
 * Link experiment to existing UC trace location
 * This only requires the catalog/schema to exist, not a warehouse
 */
private async linkExperimentToLocation(
  catalogName: string,
  schemaName: string,
  tableName: string
): Promise<string | null> {
  // Calls link API without creating tables
}
```

### Use Cases

| Scenario | Warehouse Needed? | Behavior |
|----------|-------------------|----------|
| First-time setup (table doesn't exist) | ✅ **YES** | Creates table + links experiment |
| Table already exists | ❌ **NO** | Links experiment only |
| Production app (table pre-created) | ❌ **NO** | Links experiment only |

### Configuration Updates

**`.env.example`**:
```bash
# Before
MLFLOW_TRACING_SQL_WAREHOUSE_ID=  # Required for automatic setup

# After
MLFLOW_TRACING_SQL_WAREHOUSE_ID=  # Required ONLY for initial table creation. If table exists, can be omitted.
```

## Testing Results

### Local Testing (✅ Passed)

**Command**: `npm run dev:agent`

**Logs**:
```
🔐 Getting OAuth token from Databricks CLI...
✅ Using OAuth token from Databricks CLI (profile: dogfood)
🔗 Setting up trace location: main.agent_traces
✅ Experiment linked to UC trace location: main.agent_traces.mlflow_experiment_trace_otel_spans
📊 Traces will be stored in UC table: main.agent_traces.mlflow_experiment_trace_otel_spans
✅ MLflow tracing initialized
```

**Test request**: "What is 42 * 137?" → "5,754"

**Verification**: 5 traces appeared in `main.agent_traces.mlflow_experiment_trace_otel_spans`

### Deployed App Testing (✅ Passed)

**Deployment**: `databricks bundle deploy && databricks bundle run agent_langchain_ts`

**App URL**: https://agent-lc-ts-dev-6051921418418893.staging.aws.databricksapps.com

**Logs** (showing automatic setup):
```
🔐 Getting OAuth2 access token for trace export...
✅ OAuth2 token obtained for trace export
🔗 Setting up trace location: main.agent_traces
✅ Experiment linked to UC trace location: main.agent_traces.mlflow_experiment_trace_otel_spans
📊 Traces will be stored in UC table: main.agent_traces.mlflow_experiment_trace_otel_spans
```

**Result**: ✅ Automatic UC setup working in production

## Files Modified

1. **`src/tracing.ts`**
   - Added `linkExperimentToLocation()` method for linking without warehouse
   - Updated `setupExperimentTraceLocation()` to try linking if no warehouse specified
   - Improved error messages and logging
   - Added documentation explaining warehouse requirement

2. **`.env.example`**
   - Updated comment to clarify warehouse is only needed for initial table creation

3. **`app.yaml`**
   - Added `MLFLOW_TRACING_SQL_WAREHOUSE_ID: "02c6ce260d0e8ffe"` for deployed app

## Architecture

### OTel Trace Flow

```
Agent Request
    ↓
LangGraph Execution (with @traceable decorators)
    ↓
OpenTelemetry SDK (collects spans)
    ↓
OTel Exporter (protobuf format)
    ↓
POST https://{host}/api/2.0/otel/v1/traces
    ↓
Databricks OTel Collector (authenticated with OAuth)
    ↓
Unity Catalog Table
    ↓
main.agent_traces.mlflow_experiment_trace_otel_spans
```

### Setup APIs

```
1. Create UC Location (needs warehouse):
   POST /api/4.0/mlflow/traces/location
   Body: { uc_schema, sql_warehouse_id }
   → Creates table if needed

2. Link Experiment (no warehouse):
   POST /api/4.0/mlflow/traces/{experiment_id}/link-location
   Body: { experiment_id, uc_schema }
   → Links experiment to existing table
```

## Best Practices

1. **Initial Setup**: Use warehouse ID to create tables
2. **Production**: Can omit warehouse ID if tables are pre-created
3. **Validation**: Use warehouse queries locally during development
4. **Authentication**: Always use OAuth tokens, not PAT tokens
5. **Warehouse Selection**: Use warehouse `02c6ce260d0e8ffe` (confirmed working with OTel schema)

## Key Learnings

1. **Warehouse requirement is API-level, not infrastructure-level**
   - The MLflow REST API requires it for table creation
   - The OTel collector doesn't need it for trace export
   - Once tables exist, linking works without warehouse

2. **OAuth tokens are mandatory for OTel collector**
   - PAT tokens are rejected with "Credential was not sent" errors
   - Use `databricks auth token` for local development
   - Use client credentials for deployed apps

3. **Warehouse compatibility matters**
   - Not all warehouses handle complex nested schemas equally
   - Warehouse `02c6ce260d0e8ffe` is confirmed to work
   - Test queries before deploying to production

## Related Files

- **Implementation**: `src/tracing.ts`
- **Configuration**: `.env`, `app.yaml`
- **Documentation**: `AGENTS.md`, `.env.example`
- **Tests**: `tests/integration/invocations.test.ts`

## Next Steps (Optional Improvements)

1. ✅ **Warehouse-optional linking** - Implemented
2. 🔄 **Automatic warehouse detection** - Could detect from workspace
3. 🔄 **Table existence check** - Could query catalog before creating
4. 🔄 **Retry logic** - Could retry failed setup attempts

---

**Status**: ✅ All issues resolved, tracing working end-to-end in both local and deployed environments

**Last Updated**: 2026-02-17
