---
name: run-locally
description: "Run and test the TypeScript LangChain agent locally. Use when: (1) User wants to test locally, (2) User says 'run locally', 'test agent', 'start server', or 'dev mode', (3) Debugging issues."
---

# Run Locally

## Start Development Server

```bash
npm run dev
```

This starts the server with hot-reload enabled (watches for file changes).

**Server will be available at:**
- Base URL: `http://localhost:8000`
- Health check: `http://localhost:8000/health`
- Chat API: `http://localhost:8000/api/chat`

## Start Production Build

```bash
# Build first
npm run build

# Then start
npm start
```

## Testing the Agent

### 1. Health Check

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-30T...",
  "service": "langchain-agent-ts"
}
```

### 2. Non-Streaming Chat

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is the weather in San Francisco?"}
    ]
  }'
```

Expected response:
```json
{
  "message": {
    "role": "assistant",
    "content": "The weather in San Francisco is..."
  },
  "intermediateSteps": [
    {
      "action": "get_weather",
      "observation": "The weather in San Francisco is sunny with a temperature of 70°F"
    }
  ]
}
```

### 3. Streaming Chat

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Calculate 15 * 32"}
    ],
    "stream": true
  }'
```

Expected response (Server-Sent Events):
```
data: {"chunk":"Let"}
data: {"chunk":" me"}
data: {"chunk":" calculate"}
...
data: {"done":true}
```

### 4. Multi-Turn Conversation

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is 10 + 20?"},
      {"role": "assistant", "content": "10 + 20 = 30"},
      {"role": "user", "content": "Now multiply that by 3"}
    ]
  }'
```

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

Traces are automatically exported to MLflow:

1. **In Databricks Workspace:**
   - Navigate to `/Users/<username>/agent-langchain-ts`
   - View experiment runs
   - Click on traces to see:
     - LLM calls with latency
     - Tool invocations
     - Input/output data
     - Token usage

2. **Using CLI:**
   ```bash
   databricks experiments get --experiment-id $MLFLOW_EXPERIMENT_ID
   ```

## Development Tips

### Watch Mode

`npm run dev` uses `tsx watch` which:
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
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is the weather in Tokyo?"}]}'

# Calculator tool
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Calculate 123 * 456"}]}'

# Time tool
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What time is it in London?"}]}'
```

### Test MCP Tools

First enable MCP tools in `.env`:
```bash
ENABLE_SQL_MCP=true
```

Then restart server and test:
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Show me the tables in the main catalog"}]}'
```

## Running Tests

```bash
npm test
```

This runs Jest tests in `tests/` directory.

## Troubleshooting

### "Port 8000 is already in use"

Kill existing process:
```bash
lsof -ti:8000 | xargs kill -9
```

Or change port in `.env`:
```bash
PORT=8001
```

### "Authentication failed"

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

Check tool invocation in response `intermediateSteps`:
```bash
curl -s http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is 2+2?"}]}' | jq '.intermediateSteps'
```

Should show tool name and observation.

## Performance Monitoring

Monitor server logs for:
- Request timing
- Tool execution time
- Error rates
- Token usage

Add logging in `src/server.ts`:
```typescript
console.log(`Request completed in ${duration}ms`);
```
