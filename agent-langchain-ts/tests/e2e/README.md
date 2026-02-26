# End-to-End (E2E) Tests

This directory contains tests that require a **deployed Databricks app** to run. These tests verify the full production deployment including UI, APIs, authentication, and tracing.

## Prerequisites

Before running E2E tests, you must:

1. **Deploy the app to Databricks Apps**
2. **Configure Databricks authentication**
3. **Set required environment variables**

## Quick Start

```bash
# 1. Deploy the app
npm run build
databricks bundle deploy --profile your-profile
databricks bundle run agent_langchain_ts --profile your-profile

# 2. Get the app URL
export APP_URL=$(databricks apps get agent-lc-ts-dev --profile your-profile --output json | jq -r '.url')
echo "App URL: $APP_URL"

# 3. Run E2E tests
npm run test:e2e
```

## Step-by-Step Setup

### 1. Deploy Your App

**Build the agent:**
```bash
cd /path/to/agent-langchain-ts
npm run build
```

**Deploy to Databricks:**
```bash
databricks bundle deploy --profile your-profile
databricks bundle run agent_langchain_ts --profile your-profile
```

**Verify deployment:**
```bash
databricks apps get agent-lc-ts-dev --profile your-profile
```

Expected output:
```json
{
  "name": "agent-lc-ts-dev",
  "status": {
    "state": "RUNNING"
  },
  "url": "https://agent-lc-ts-dev-*.databricksapps.com"
}
```

### 2. Configure Authentication

E2E tests use the Databricks CLI for OAuth authentication.

**Ensure you have a configured profile:**
```bash
databricks auth profiles
```

**If no profiles exist:**
```bash
databricks auth login --profile your-profile
```

The tests will automatically fetch OAuth tokens using `databricks auth token`.

### 3. Set Environment Variables

**Required:**
```bash
export APP_URL="https://your-app-url.databricksapps.com"
```

**Optional (for custom profile):**
```bash
export DATABRICKS_CLI_PROFILE="your-profile"
```

### 4. Run E2E Tests

**Run all E2E tests:**
```bash
npm run test:e2e
```

**Run a specific E2E test:**
```bash
npm test tests/e2e/deployed.test.ts
npm test tests/e2e/ui-auth.test.ts
npm test tests/e2e/api-chat-followup.test.ts
npm test tests/e2e/tracing.test.ts
```

## Test Files

### `deployed.test.ts`
Tests production deployment including:
- ✅ UI serving (HTML at `/`)
- ✅ `/invocations` endpoint (Responses API)
- ✅ `/api/chat` endpoint (useChat format)
- ✅ Tool calling (calculator, time tools)
- ✅ Streaming responses

**Requires:**
- Deployed app
- OAuth authentication
- `APP_URL` environment variable

### `ui-auth.test.ts`
Tests UI authentication and session management:
- ✅ `/api/session` returns valid user session JSON
- ✅ `/api/config` returns valid configuration
- ✅ Proxy preserves authentication headers
- ✅ Returns JSON (not HTML) for API routes

**Requires:**
- Deployed app with authentication enabled
- OAuth token

### `api-chat-followup.test.ts`
Tests multi-turn conversations via `/api/chat`:
- ✅ Followup questions after tool calls
- ✅ Context preservation across turns
- ✅ Tool call result handling
- ✅ Proper message formatting

**Requires:**
- Deployed app
- Working `/api/chat` endpoint

### `tracing.test.ts`
Tests MLflow tracing integration:
- ✅ Trace configuration
- ✅ Experiment ID setup
- ✅ Trace export to Unity Catalog
- ✅ Multiple sequential requests
- ✅ Trace metadata

**Requires:**
- Deployed app with tracing configured
- `MLFLOW_EXPERIMENT_ID` set
- `OTEL_UC_TABLE_NAME` set (for trace export tests)

## Troubleshooting

### "fetch failed" or connection errors

**Problem:** Tests can't reach the deployed app.

**Solutions:**
1. Verify app is running:
   ```bash
   databricks apps get agent-lc-ts-dev --profile your-profile
   ```

2. Check APP_URL is correct:
   ```bash
   echo $APP_URL
   ```

3. Test manually:
   ```bash
   TOKEN=$(databricks auth token --profile your-profile | jq -r '.access_token')
   curl -I "$APP_URL" -H "Authorization: Bearer $TOKEN"
   ```

### "401 Unauthorized" errors

**Problem:** Authentication is failing.

**Solutions:**
1. Refresh your OAuth token:
   ```bash
   databricks auth token --profile your-profile
   ```

2. Check profile is configured:
   ```bash
   databricks auth profiles
   ```

3. Ensure tests are using correct profile:
   ```bash
   export DATABRICKS_CLI_PROFILE="your-profile"
   ```

### "404 Not Found" on API routes

**Problem:** App routes are not set up correctly.

**Solutions:**
1. Check app logs:
   ```bash
   databricks apps logs agent-lc-ts-dev --follow --profile your-profile
   ```

2. Verify build includes UI files:
   ```bash
   ls -la ui/client/dist
   ls -la ui/server/dist
   ```

3. Rebuild and redeploy:
   ```bash
   npm run build
   databricks bundle deploy --profile your-profile
   databricks bundle run agent_langchain_ts --profile your-profile
   ```

### Trace export tests failing

**Problem:** Tracing tests fail with "OTEL_UC_TABLE_NAME not set".

**This is expected for local tests** - these tests are specifically for deployed apps with tracing configured.

**To fix for deployed tests:**
1. Set up Unity Catalog tables for traces
2. Configure `OTEL_UC_TABLE_NAME` in `databricks.yml`
3. Verify experiment ID is set

## Complete Example Workflow

Here's a full example from deployment to testing:

```bash
# 1. Build
npm run build

# 2. Deploy
databricks bundle deploy
databricks bundle run agent_langchain_ts

# 3. Wait for app to start (check status)
databricks apps get agent-lc-ts-dev

# 4. Set environment variables
export APP_URL=$(databricks apps get agent-lc-ts-dev --output json | jq -r '.url')
export DATABRICKS_CLI_PROFILE="${DATABRICKS_CONFIG_PROFILE:-DEFAULT}"

echo "Testing app at: $APP_URL"

# 5. Test authentication
TOKEN=$(databricks auth token | jq -r '.access_token')
curl -I "$APP_URL/api/session" -H "Authorization: Bearer $TOKEN"

# 6. Run E2E tests
npm run test:e2e

# 7. Run specific test
npm test tests/e2e/deployed.test.ts
```

## CI/CD Integration

For automated testing in CI/CD pipelines:

```bash
#!/bin/bash
set -e

# Deploy
databricks bundle deploy --profile ci
databricks bundle run agent_langchain_ts --profile ci

# Wait for app to be ready
until databricks apps get agent-lc-ts-dev --profile ci --output json | jq -e '.status.state == "RUNNING"'; do
  echo "Waiting for app to start..."
  sleep 10
done

# Get app URL
export APP_URL=$(databricks apps get agent-lc-ts-dev --profile ci --output json | jq -r '.url')

# Run E2E tests
npm run test:e2e

# Cleanup
databricks bundle destroy --profile ci
```

## Test Maintenance

When adding new E2E tests:

1. **Place them in `tests/e2e/`**
2. **Name them `*.test.ts`**
3. **Use `getDeployedAuthToken()` helper** (from `tests/helpers.ts`)
4. **Add clear error messages** for debugging
5. **Set appropriate timeouts** (deployed requests are slower)
6. **Document prerequisites** in test file comments

Example:
```typescript
/**
 * My E2E test
 *
 * Prerequisites:
 * - App deployed with XYZ feature enabled
 * - Environment variable FOO set
 *
 * Run with: APP_URL=<url> npm test tests/e2e/my-test.test.ts
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import { getDeployedAuthToken } from "../helpers.js";

const APP_URL = process.env.APP_URL || "https://default-url.databricksapps.com";
```

## Related Documentation

- [AGENTS.md](../../AGENTS.md) - Agent development guide
- [databricks.yml](../../databricks.yml) - Deployment configuration
- [tests/helpers.ts](../helpers.ts) - Shared test utilities

---

**Need help?** Check the main [README](../../README.md) or deployment guide in AGENTS.md.
