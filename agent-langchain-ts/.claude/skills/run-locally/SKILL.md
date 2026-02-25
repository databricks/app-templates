---
name: run-locally
description: "Run and test the TypeScript LangChain agent locally. Use when: (1) User wants to test locally, (2) User says 'run locally', 'test agent', 'start server', or 'dev mode', (3) Debugging issues."
---

# Run Locally

## First-Time Setup

Before starting the server, set up the UI (needed once, or after UI changes):
```bash
npm run setup
```

This clones/updates `e2e-chatbot-app-next` into the `ui/` directory.

## Start Development Servers

**Agent-only dev (recommended for iterating on agent code):**
```bash
npm run dev:agent
```

Starts agent server on port 5001 with hot-reload. Just `/invocations` and `/health`.

**Full stack legacy dev (agent + UI, both with hot-reload):**
```bash
npm run dev:legacy
```

Runs agent on port 5001 + UI dev server on port 3001. Open `http://localhost:3001` for the UI.

**Production build (agent + UI served together):**
```bash
npm run build
npm start
```

Starts unified server on port 8000 with agent + UI frontend both served. Use this to test the full in-process integration.

**Endpoints by mode:**

| Mode | Agent | UI frontend | UI backend |
|------|-------|-------------|------------|
| `dev:agent` | `localhost:5001/invocations` | — | — |
| `dev:legacy` | `localhost:5001/invocations` | `localhost:3001/` | `localhost:3001/api/chat` |
| `npm start` | `localhost:8000/invocations` | `localhost:8000/` | `localhost:8000/api/chat` |

## Testing the Agent

### 1. Test /invocations Endpoint (Responses API)

**With production build (port 8000):**
```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {"role": "user", "content": "What is the weather in San Francisco?"}
    ],
    "stream": true
  }'
```

**With agent-only server (port 5001):**
```bash
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {"role": "user", "content": "What is the weather in San Francisco?"}
    ],
    "stream": true
  }'
```

Expected response (Server-Sent Events):
```
data: {"type":"response.output_item.added","item":{"type":"message",...}}
data: {"type":"response.output_text.delta","delta":"The weather..."}
...
data: {"type":"response.completed"}
data: [DONE]
```

### 2. Test /api/chat Endpoint (useChat Format)

**Requires full stack running** (`npm start` or `npm run dev:legacy`)

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "role": "user",
      "parts": [{"type": "text", "text": "Calculate 15 * 32"}]
    },
    "selectedChatModel": "chat-model"
  }'
```

Expected response (AI SDK format):
```
data: {"type":"text-delta","delta":"Let me calculate..."}
data: {"type":"tool-call",...}
...
data: [DONE]
```

### 3. Test UI Frontend

Open browser: `http://localhost:8000` (production build) or `http://localhost:3001` (legacy dev)

Should see chat interface with:
- Message input
- Send button
- Chat history
- Tool call indicators

## Environment Variables

Make sure `.env` is configured (see **quickstart** skill):

```bash
# Required
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=dapi...
DATABRICKS_MODEL=databricks-claude-sonnet-4-5
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_ID=123

# Optional
PORT=8000
TEMPERATURE=0.1
MAX_TOKENS=2000
ENABLE_SQL_MCP=false
```

## View MLflow Traces

See [MLflow Tracing Guide](../_shared/MLFLOW.md) for viewing traces in your workspace.

## Development Tips

### Watch Mode

`npm run dev:agent` uses `tsx watch` which:
- Auto-restarts on file changes
- Preserves type checking
- Fast compilation

### TypeScript Compilation

Manual compilation:
```bash
npm run build
```

Output in `dist/` directory.

### Debugging

Add `console.log()` statements and view in terminal:

```typescript
console.log("Tool invoked:", toolName);
console.log("Result:", result);
```

For deeper debugging, use VS Code debugger:
1. Set breakpoints in `.ts` files
2. Press F5 or use Run > Start Debugging
3. Select "Node.js" as runtime

## Testing Tools

### Test Basic Tools

```bash
# Weather tool
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "What is the weather in Tokyo?"}], "stream": false}'

# Calculator tool
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Calculate 123 * 456"}], "stream": false}'

# Time tool
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "What time is it in London?"}], "stream": false}'
```

### Test MCP Tools

MCP tools are configured in `src/mcp-servers.ts`. See **add-tools** skill for details.

Example test:
```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "Query my database"}], "stream": false}'
```

## Running Tests

### Unit Tests (No Server Required)

Pure tests with no dependencies:
```bash
npm run test:unit
```

Runs `tests/agent.test.ts` - tests agent initialization, tool usage, multi-turn conversations.

### Integration Tests (Requires Local Servers)

Tests that need local servers running:
```bash
# Terminal 1: Start servers (agent + UI)
npm run dev:legacy  # or: npm run build && npm start

# Terminal 2: Run tests
npm run test:integration
```

Tests: `/invocations`, `/api/chat`, streaming, error handling.

### E2E Tests (Requires Deployed App)

Tests that need a deployed Databricks app:
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

See `tests/e2e/README.md` for detailed setup instructions.

### All Non-E2E Tests

```bash
npm run test:all
```

Runs unit + integration tests (not E2E).

## Troubleshooting

See [Troubleshooting Guide](../_shared/TROUBLESHOOTING.md) for common issues.

### Quick Fixes

**Port already in use:**
```bash
lsof -ti:8000 | xargs kill -9  # Unified server
lsof -ti:5001 | xargs kill -9  # Agent-only server (if running separately)
```

**Authentication failed:**

Verify credentials:
```bash
databricks auth profiles
databricks auth env --host
databricks auth env --token
```

Re-run quickstart:
```bash
npm run quickstart
```

### "Module not found"

Install dependencies:
```bash
npm install
```

### "MLflow traces not appearing"

Check:
1. `MLFLOW_EXPERIMENT_ID` is set in `.env`
2. Experiment exists: `databricks experiments get --experiment-id $MLFLOW_EXPERIMENT_ID`
3. Server logs show "MLflow tracing initialized"

Create experiment if missing:
```bash
databricks experiments create \
  --experiment-name "/Users/$(databricks current-user me --output json | jq -r .userName)/agent-langchain-ts"
```

### "Tool not working"

Test tool invocation via `/invocations`:
```bash
curl -s -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "What is 2+2?"}], "stream": false}'
```

Should include tool call events in the SSE response.

## Performance Monitoring

Monitor server logs for:
- Request timing
- Tool execution time
- Error rates
- Token usage

Add logging in `src/plugins/agent/AgentPlugin.ts` or `src/routes/invocations.ts`:
```typescript
console.log(`Request completed in ${duration}ms`);
```
