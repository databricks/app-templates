# Tests

This directory contains tests for the TypeScript LangChain agent.

## Test Types

### Unit Tests (No Server Required)
These tests run standalone without any servers:
- `agent.test.ts` - Core agent initialization and functionality
- `error-handling.test.ts` - Error handling scenarios

**Run:**
```bash
npm run test:unit
```

### Local Integration Tests (Require Local Servers)
These tests require **local servers** to be running:
- `endpoints.test.ts` - Tests /invocations endpoint locally
- `use-chat.test.ts` - Tests /api/chat endpoint locally
- `agent-mcp-streaming.test.ts` - Tests streaming functionality
- `integration.test.ts` - General integration tests

**Run:**
```bash
# Terminal 1: Start servers
npm run dev

# Terminal 2: Run integration tests
npm run test:integration
```

### E2E Tests (Require Deployed App)
These tests require a **deployed Databricks app**:
- Located in `tests/e2e/`
- See [tests/e2e/README.md](e2e/README.md) for setup instructions

**Run:**
```bash
# After deploying to Databricks
export APP_URL=<your-deployed-app-url>
npm run test:e2e
```

## Quick Reference

```bash
# All unit tests (no servers needed)
npm run test:unit

# Integration tests (requires local servers running)
npm run test:integration

# E2E tests (requires deployed app)
npm run test:e2e

# All non-E2E tests
npm run test:all
```

## CI/CD Considerations

For CI/CD pipelines:

1. **Unit tests** can run in any environment
2. **Integration tests** require starting local servers first
3. **E2E tests** require deploying the app and setting `APP_URL`

Example CI workflow:
```bash
# Install
npm install

# Unit tests (always run)
npm run test:unit

# Start servers in background for integration tests
npm run dev &
SERVER_PID=$!
sleep 10  # Wait for servers to start

# Integration tests
npm run test:integration

# Clean up
kill $SERVER_PID

# E2E tests (only on deploy)
if [ "$DEPLOY" = "true" ]; then
  databricks bundle deploy
  export APP_URL=$(databricks apps get agent-lc-ts-dev --output json | jq -r '.url')
  npm run test:e2e
fi
```

## Test Helpers

Common test utilities are in `helpers.ts`:
- `getDeployedAuthToken()` - Gets OAuth token for deployed app tests
- `parseSSEStream()` - Parses Server-Sent Events (Responses API format)
- `parseAISDKStream()` - Parses AI SDK streaming format
- `makeAuthHeaders()` - Creates authorization headers
- `callInvocations()` - Helper for calling /invocations endpoint

## Adding New Tests

### Unit Test
Place in `tests/` directory, no special setup needed:
```typescript
import { describe, test, expect } from '@jest/globals';
import { myFunction } from '../src/my-module.js';

describe("My Unit Test", () => {
  test("should work", () => {
    expect(myFunction()).toBe(expected);
  });
});
```

### Local Integration Test
Place in `tests/` directory, document that servers must be running:
```typescript
/**
 * Integration test for local development
 *
 * Prerequisites:
 * - Start servers: npm run dev
 * - Agent on port 5001, UI on port 3001
 */
import { describe, test, expect } from '@jest/globals';

const AGENT_URL = "http://localhost:5001";

describe("My Integration Test", () => {
  test("should call local endpoint", async () => {
    const response = await fetch(`${AGENT_URL}/invocations`, {...});
    expect(response.ok).toBe(true);
  });
});
```

### E2E Test
Place in `tests/e2e/` directory:
```typescript
/**
 * E2E test for deployed app
 *
 * Prerequisites:
 * - Deploy app: databricks bundle deploy
 * - Set APP_URL environment variable
 *
 * Run with: APP_URL=<url> npm run test:e2e
 */
import { describe, test, expect, beforeAll } from '@jest/globals';
import { getDeployedAuthToken } from '../helpers.js';

const APP_URL = process.env.APP_URL || "https://default.databricksapps.com";
let authToken: string;

beforeAll(async () => {
  authToken = await getDeployedAuthToken();
});

describe("My E2E Test", () => {
  test("should work with deployed app", async () => {
    const response = await fetch(`${APP_URL}/invocations`, {
      headers: { Authorization: `Bearer ${authToken}` },
      // ...
    });
    expect(response.ok).toBe(true);
  });
});
```

## Troubleshooting

### Tests timing out
- Increase timeout in jest.config.js or test file
- Check if servers are running for integration tests
- Verify deployed app is accessible for E2E tests

### "fetch failed" errors
- **Integration tests**: Ensure `npm run dev` is running
- **E2E tests**: Verify `APP_URL` is set and app is deployed

### Authentication errors
- **E2E tests**: Run `databricks auth token --profile your-profile` to refresh
- Check `DATABRICKS_CLI_PROFILE` environment variable

---

For more details:
- **E2E tests**: See [tests/e2e/README.md](e2e/README.md)
- **Agent development**: See [AGENTS.md](../AGENTS.md)
- **Test configuration**: See [jest.config.js](../jest.config.js)
