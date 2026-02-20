# Test Organization Summary

## Overview

Tests have been reorganized into three categories:
1. **Unit Tests** - Pure tests with no external dependencies
2. **Integration Tests** - Tests requiring local servers
3. **E2E Tests** - Tests requiring a deployed Databricks app

## Test Structure

```
tests/
├── agent.test.ts                    # ✅ Unit test (no server needed)
├── endpoints.test.ts                # 🔧 Integration test (local servers)
├── use-chat.test.ts                 # 🔧 Integration test (local servers)
├── agent-mcp-streaming.test.ts      # 🔧 Integration test (local servers)
├── integration.test.ts              # 🔧 Integration test (local servers)
├── error-handling.test.ts           # 🔧 Integration test (local servers)
├── helpers.ts                       # Shared test utilities
├── README.md                        # Test documentation
└── e2e/
    ├── deployed.test.ts             # 🚀 E2E test (deployed app)
    ├── ui-auth.test.ts              # 🚀 E2E test (deployed app)
    ├── api-chat-followup.test.ts    # 🚀 E2E test (deployed app)
    ├── followup-questions.test.ts   # 🚀 E2E test (deployed app)
    ├── tracing.test.ts              # 🚀 E2E test (deployed app)
    └── README.md                    # E2E test guide
```

## Running Tests

### Unit Tests (No Setup Required)
```bash
npm run test:unit
```
- Runs: `tests/agent.test.ts`
- Tests: Agent initialization, tool usage, multi-turn conversations
- No servers or deployment needed ✅

### Integration Tests (Requires Local Servers)
```bash
# Terminal 1: Start servers
npm run dev

# Terminal 2: Run tests
npm run test:integration
```
- Runs: `endpoints.test.ts`, `use-chat.test.ts`, `agent-mcp-streaming.test.ts`, `integration.test.ts`, `error-handling.test.ts`
- Tests: Local /invocations and /api/chat endpoints, streaming, error handling
- Requires: Agent server (port 5001) + UI server (port 3001)

### E2E Tests (Requires Deployed App)
```bash
# 1. Deploy app
npm run build
databricks bundle deploy --profile your-profile
databricks bundle run agent_langchain_ts --profile your-profile

# 2. Set APP_URL
export APP_URL=$(databricks apps get agent-lc-ts-dev --profile your-profile --output json | jq -r '.url')

# 3. Run E2E tests
npm run test:e2e
```
- Runs: All tests in `tests/e2e/`
- Tests: Production deployment, authentication, tracing, full workflows
- Requires: Deployed Databricks app + OAuth authentication

### All Non-E2E Tests
```bash
npm run test:all
```
- Runs: Unit + Integration tests (not E2E)
- Useful for local CI checks before deployment

## Test Count Summary

| Category | Test Files | Test Cases | Prerequisites |
|----------|-----------|-----------|---------------|
| Unit | 1 | 6 | None |
| Integration | 5 | ~15 | Local servers |
| E2E | 5 | ~17 | Deployed app |
| **Total** | **11** | **~38** | - |

## Configuration Files

- `jest.config.js` - Main Jest config, excludes e2e tests
- `jest.e2e.config.js` - E2E-specific config, longer timeouts
- `package.json` - Test scripts

## Key Changes Made

1. ✅ Moved 5 tests requiring deployed app to `tests/e2e/`
   - `deployed.test.ts`
   - `ui-auth.test.ts`
   - `api-chat-followup.test.ts`
   - `followup-questions.test.ts`
   - `tracing.test.ts`

2. ✅ Created `tests/e2e/README.md` with detailed setup instructions
   - Prerequisites
   - Step-by-step deployment guide
   - Troubleshooting section
   - Example workflows

3. ✅ Updated Jest configuration
   - `jest.config.js` now excludes e2e tests by default
   - `jest.e2e.config.js` created with 120s timeout

4. ✅ Updated npm scripts
   - `test:unit` - Only runs pure unit tests (agent.test.ts)
   - `test:integration` - Runs all local integration tests
   - `test:e2e` - Runs deployed app tests
   - `test:all` - Runs unit + integration (not e2e)

5. ✅ Created test documentation
   - `tests/README.md` - Overview of all test types
   - `tests/e2e/README.md` - E2E-specific guide

## CI/CD Recommendations

### Basic CI Pipeline
```bash
# Always run unit tests
npm run test:unit

# Run integration tests if local servers can be started
npm run dev &
sleep 10
npm run test:integration
```

### Full CI Pipeline with Deployment
```bash
# Unit tests
npm run test:unit

# Deploy
databricks bundle deploy
databricks bundle run agent_langchain_ts

# E2E tests
export APP_URL=$(databricks apps get agent-lc-ts-dev --output json | jq -r '.url')
npm run test:e2e

# Cleanup
databricks bundle destroy
```

## Next Steps

To run tests right now:

1. **Unit tests** (works immediately):
   ```bash
   npm run test:unit
   ```

2. **Integration tests** (need to start servers first):
   ```bash
   # Terminal 1
   npm run dev

   # Terminal 2
   npm run test:integration
   ```

3. **E2E tests** (need to deploy first):
   ```bash
   # See tests/e2e/README.md for full instructions
   npm run test:e2e
   ```

---

**Documentation:**
- Full test guide: [tests/README.md](tests/README.md)
- E2E test setup: [tests/e2e/README.md](tests/e2e/README.md)
- Agent development: [AGENTS.md](AGENTS.md)
