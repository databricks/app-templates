# TypeScript Agent Template: Two-Server Architecture with Clean API Contract

## Summary

Implements a clean two-server architecture for the TypeScript LangChain agent template that enables independent development of the agent and UI while maintaining a standard API contract via the `/invocations` endpoint.

## Motivation

The e2e-chatbot-app-next UI template serves multiple backends and must remain independently developable. This PR establishes a clean separation where:
- The agent template provides a standard MLflow-compatible `/invocations` endpoint
- The UI communicates with the agent exclusively through this endpoint via `API_PROXY`
- Both components can be developed independently without tight coupling

## Architecture

### Two-Server Setup

```
┌─────────────────────┐
│ UI Frontend         │
│ (React - port 5000) │
└──────────┬──────────┘
           │ /api/chat
           ↓
┌─────────────────────┐         API_PROXY          ┌──────────────────┐
│ UI Backend          │ ─────────────────────────> │ Agent Server     │
│ (Express - port     │    /invocations            │ (port 5001)      │
│ 3001)               │ <───────────────────────── │                  │
└─────────────────────┘    Responses API           └──────────────────┘
```

### Request Flow

1. **User** → Frontend (localhost:5000)
2. **Frontend** → UI Backend `/api/chat` (localhost:3001)
3. **UI Backend** → Agent Server `/invocations` (localhost:5001) via `API_PROXY`
4. **Agent Server** → Processes with LangChain agent, returns Responses API format
5. **Response** → Flows back through chain to user

## Changes

### agent-langchain-ts/

#### New Files
- **`src/routes/invocations.ts`**: MLflow-compatible `/invocations` endpoint
  - Accepts Responses API request format
  - Runs LangChain agent with tool calling
  - Streams responses in Responses API format (SSE)
  - Converts LangChain events → Responses API events

- **`scripts/setup-ui.sh`**: Auto-fetch UI workspace script
  - Checks if `./ui` exists (done)
  - Checks if `../e2e-chatbot-app-next` exists (symlink)
  - Otherwise clones from GitHub (sparse checkout)

- **Documentation**:
  - `REQUIREMENTS.md` - Architecture requirements and constraints
  - `ARCHITECTURE_FINAL.md` - Complete architecture documentation
  - `E2E_TEST_RESULTS.md` - End-to-end test results

#### Modified Files
- **`package.json`**:
  - Added `concurrently` for running multiple servers
  - Added npm workspace for `ui/`
  - Updated `dev` script to start both agent + UI servers
  - Set `DATABRICKS_CONFIG_PROFILE` and `API_PROXY` environment variables

- **`src/server.ts`**:
  - Simplified to only provide `/invocations` and `/health` endpoints
  - Removed UI route mounting (clean separation)
  - Fixed path handling for dev vs production modes
  - Clear logging for agent-only mode

### e2e-chatbot-app-next/

#### Bug Fixes Only
- **`package.json`**: Fixed invalid package name (`databricks/e2e-chatbot-app` → `@databricks/e2e-chatbot-app`)
- **`client/vite.config.ts`**: Fixed proxy target port (5001 → 3001)
- **`.env`**: Updated `DATABRICKS_CONFIG_PROFILE` to match agent profile

**Note**: These are pre-existing bugs, not architecture changes. The UI remains completely independent.

## Developer Workflow

```bash
# Clone and run agent template
cd agent-langchain-ts
npm run dev  # Auto-fetches UI, starts both servers

# Access UI
open http://localhost:5000

# Customize agent behavior
vim src/agent.ts  # Changes hot-reload automatically

# Test /invocations directly
curl -N -X POST http://localhost:5001/invocations \
  -H 'Content-Type: application/json' \
  --data '{"input":[{"role":"user","content":"Hello"}],"stream":true}'
```

## Key Benefits

### 1. Clean Contract
- UI queries standard `/invocations` endpoint (MLflow-compatible)
- Same interface as Python agent template
- No tight coupling between implementations

### 2. Independent Development
- Modify `agent-langchain-ts` without touching UI code
- Modify `e2e-chatbot-app-next` without touching agent code
- UI can be reused with different backends

### 3. Type Safety
- npm workspaces provide shared TypeScript types
- Better IDE support across stack
- Catch errors at compile time

### 4. Flexible Deployment
- Can deploy together or separately
- UI backend points to any `/invocations` endpoint via `API_PROXY`
- Supports multiple agent backends

## Testing

### E2E Test Results

✅ **Direct Agent Query** (Responses API format)
```bash
curl localhost:5001/invocations
→ Tool calls work correctly ✓
→ Streaming works ✓
→ Responses API format validated ✓
```

✅ **UI Backend Proxy** (via API_PROXY)
```bash
curl localhost:3001/api/chat
→ Proxies to agent /invocations ✓
→ Format conversion (Responses API → AI SDK) ✓
→ Returns correct results ✓
```

✅ **Full Chain** (Browser → UI → Agent)
```
Frontend → UI Backend → Agent Server → LangChain → Response
All working correctly! ✓
```

### Example Response
```
Question: "What is 3+3?"
Agent: Streamed response with tool execution
Result: "3 + 3 = 6"
```

## API Contract: /invocations

### Request Format (Responses API)
```json
{
  "input": [
    {"role": "user", "content": "What is 2+2?"}
  ],
  "stream": true
}
```

### Response Format (Server-Sent Events)
```
data: {"type":"response.output_item.done","item":{"type":"function_call",...}}
data: {"type":"response.output_item.done","item":{"type":"function_call_output",...}}
data: {"type":"response.output_text.delta","item_id":"...","delta":"The answer is "}
data: {"type":"response.output_text.delta","item_id":"...","delta":"4"}
data: {"type":"response.completed"}
data: [DONE]
```

## Comparison with Python Template

| Aspect | Python Template | TypeScript Template |
|--------|----------------|---------------------|
| **Architecture** | Single server | Two servers (cleaner separation) |
| **Contract** | `/invocations` | `/invocations` ✅ Same |
| **UI Fetching** | Runtime clone | Setup script |
| **Type Safety** | None | Full TypeScript |
| **Hot Reload** | ✅ Yes | ✅ Yes (tsx watch) |
| **Independent UI** | ✅ Yes | ✅ Yes (via API_PROXY) |
| **Single Command** | ✅ Yes | ✅ Yes (`npm run dev`) |

## Environment Variables

### Agent Server
```bash
PORT=5001
DATABRICKS_CONFIG_PROFILE=dogfood
DATABRICKS_SERVING_ENDPOINT=databricks-claude-sonnet-4-5
MLFLOW_EXPERIMENT_ID=...
```

### UI Server (Automatically Set)
```bash
API_PROXY=http://localhost:5001/invocations  # Points to agent
CHAT_APP_PORT=3001
DATABRICKS_CONFIG_PROFILE=dogfood  # Matches agent profile
```

## Breaking Changes

None. This is a new feature that doesn't affect existing functionality.

## Migration Guide

For developers currently using agent-langchain-ts:

**Before:**
```bash
npm run dev  # Started agent server only
```

**After:**
```bash
npm run dev  # Starts agent server + UI automatically
```

The `/invocations` endpoint is new. Existing usage remains unchanged.

## Future Work

- [ ] Document deployment patterns for production
- [ ] Add integration tests for proxy chain
- [ ] Support custom UI configurations
- [ ] Add example .env files
- [ ] Document how to swap agent implementations

## Checklist

- [x] Code changes tested locally
- [x] Documentation updated
- [x] E2E testing completed
- [x] No breaking changes to existing APIs
- [x] Minimal changes to e2e-chatbot-app-next (bug fixes only)
- [x] Clean separation of concerns maintained

## Related Issues

Closes: (add issue number if applicable)

## Screenshots

(User can add screenshots of the working UI)

---

**Deployment Note**: When deploying to production, set `API_PROXY` environment variable in the UI server to point to the production agent server's `/invocations` endpoint.
