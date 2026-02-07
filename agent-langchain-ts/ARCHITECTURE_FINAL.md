# Final Architecture: Two-Server Setup

## Overview

The agent-langchain-ts template now uses a **clean two-server architecture** that maintains separation of concerns while enabling full end-to-end integration.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer Workflow                        │
│                                                              │
│  $ cd agent-langchain-ts                                    │
│  $ npm run dev        # Starts both servers automatically   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
        ┌─────────────────────┴─────────────────────┐
        │                                            │
        ↓                                            ↓
┌──────────────────┐                        ┌──────────────────┐
│  Agent Server    │                        │  UI Server       │
│  Port: 5001      │                        │  Port: 3001/5000 │
│                  │                        │                  │
│  /invocations    │←───API_PROXY──────────│  Backend (3001)  │
│  /health         │                        │  Frontend (5000) │
│                  │                        │                  │
│  Responses API   │                        │  /api/chat       │
│  format          │                        │  /api/history    │
└──────────────────┘                        │  /api/messages   │
                                            └──────────────────┘
```

## Request Flow

### 1. User Interacts with UI (Browser → Frontend)
```
User types message in browser
    ↓
http://localhost:5000/ (React UI via Vite)
```

### 2. Frontend → Backend (UI Internal)
```
Frontend sends request
    ↓
POST /api/chat → http://localhost:3001/api/chat
    (UI Backend Server)
```

### 3. Backend → Agent (Via API_PROXY)
```
UI Backend (with API_PROXY set)
    ↓
POST /invocations → http://localhost:5001/invocations
    (Agent Server - Responses API format)
```

### 4. Agent Processing
```
Agent Server:
- Receives Responses API request
- Runs LangChain agent
- Streams events (tool calls, text deltas)
- Returns Responses API format (SSE)
```

### 5. Response Back to User
```
Agent → UI Backend → UI Frontend → Browser
(Responses API) → (AI SDK format) → (React components) → (Display)
```

## Server Details

### Agent Server (Port 5001)

**File:** `src/server.ts`

**Responsibilities:**
- Provide `/invocations` endpoint (MLflow-compatible)
- Run LangChain agent with custom tools
- Stream responses in Responses API format
- MLflow tracing integration

**Endpoints:**
- `GET /health` - Health check
- `POST /invocations` - Agent invocation (Responses API)
- `GET /` - Server info

**Started by:** `npm run dev:agent`

### UI Server (Ports 3001 + 5000)

**Location:** `ui/` (workspace - auto-fetched from e2e-chatbot-app-next)

**Components:**
1. **Backend Server (Port 3001)**
   - Express server with API routes
   - Environment: `API_PROXY=http://localhost:5001/invocations`
   - Proxies requests to agent server
   - Converts between Responses API and AI SDK formats

2. **Frontend Dev Server (Port 5000)**
   - Vite development server
   - React application
   - Queries `/api/chat` on port 3001

**Started by:** `npm run dev:ui`

## Configuration

### package.json Scripts

```json
{
  "scripts": {
    "predev": "bash scripts/setup-ui.sh",
    "dev": "concurrently --names \"agent,ui\" \"npm run dev:agent\" \"npm run dev:ui\"",
    "dev:agent": "PORT=5001 tsx watch src/server.ts",
    "dev:ui": "cd ui && API_PROXY=http://localhost:5001/invocations CHAT_APP_PORT=3001 npm run dev"
  }
}
```

### Environment Variables

**Agent Server:**
- `PORT=5001` - Server port
- `DATABRICKS_CONFIG_PROFILE` - Auth profile
- `DATABRICKS_SERVING_ENDPOINT` - Model endpoint (optional)
- `MLFLOW_EXPERIMENT_ID` - MLflow experiment

**UI Server:**
- `API_PROXY=http://localhost:5001/invocations` - **Critical:** Points to agent
- `CHAT_APP_PORT=3001` - Backend server port
- UI frontend defaults to port 5000 (Vite)

## Key Benefits

### 1. Clean Contract
- UI queries agent via standard `/invocations` endpoint
- Same interface as Python template
- No tight coupling between implementations

### 2. Independent Development
- Modify `agent-langchain-ts/src/agent.ts` without touching UI
- Modify `e2e-chatbot-app-next` without touching agent
- UI can be reused with different backends

### 3. Type Safety
- npm workspaces provide shared types
- TypeScript across agent and UI
- Better IDE support

### 4. Single Command Workflow
```bash
cd agent-langchain-ts
npm run dev  # Everything works!
```

### 5. Flexible Deployment
- Can deploy together or separately
- UI backend can point to any `/invocations` endpoint
- Supports multiple agent backends

## Developer Workflow

### Initial Setup
```bash
# Clone repository
git clone https://github.com/databricks/app-templates
cd agent-langchain-ts

# Run dev (auto-fetches UI)
npm run dev
```

### Customize Agent
```bash
# Modify agent behavior
vim src/agent.ts

# Changes hot-reload automatically
# Test at http://localhost:5000
```

### Test /invocations Directly
```bash
curl -N -X POST http://localhost:5001/invocations \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'EOF'
{"input":[{"role":"user","content":"Hello"}],"stream":true}
EOF
```

### Access UI
```
Frontend: http://localhost:5000/
Backend:  http://localhost:3001/
Agent:    http://localhost:5001/
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
| **Single Command** | ✅ Yes | ✅ Yes |

## Production Deployment

### Option A: Deploy Together
```bash
npm run build  # Builds both agent and UI
npm start      # Starts agent server
cd ui && npm start  # Starts UI server
```

Configure UI with `API_PROXY` pointing to agent server URL.

### Option B: Deploy Separately
- Deploy agent server to one host
- Deploy UI server to another host
- Set `API_PROXY` to agent server URL

### Option C: Databricks Apps
Both can be deployed as Databricks Apps with appropriate configuration.

## Troubleshooting

### UI can't reach agent
- Check `API_PROXY` environment variable is set
- Verify agent server is running on port 5001
- Check network connectivity between servers

### Agent changes not reflecting
- tsx watch should auto-reload
- Check console for TypeScript errors
- Restart dev server if needed

### UI won't start
- Ensure `ui/` directory exists (run `npm run dev` to auto-fetch)
- Check for port conflicts (3001, 5000)
- Verify npm workspaces are installed

## Success Criteria

✅ Developer clones agent-langchain-ts and runs `npm run dev`
✅ Both servers start automatically
✅ UI accessible at http://localhost:5000
✅ Agent queries work end-to-end
✅ Tool calls display correctly in UI
✅ Changes to `src/agent.ts` hot-reload
✅ External clients can query `/invocations` directly
✅ UI and agent can be developed independently

## Files Modified

1. **agent-langchain-ts/package.json**
   - Added `concurrently` dependency
   - Updated `dev` script to start both servers
   - Added `dev:agent` and `dev:ui` scripts

2. **agent-langchain-ts/src/server.ts**
   - Simplified to only provide `/invocations` endpoint
   - Removed UI route mounting (clean separation)
   - Fixed path handling for dev/prod modes

3. **agent-langchain-ts/src/routes/invocations.ts**
   - Created MLflow-compatible endpoint
   - Converts LangChain events to Responses API format
   - Handles streaming and non-streaming modes

4. **agent-langchain-ts/scripts/setup-ui.sh**
   - Auto-fetches UI workspace
   - Three modes: existing, symlink, clone

5. **e2e-chatbot-app-next/package.json**
   - Fixed package name to use scoped format

6. **e2e-chatbot-app-next/server/src/index.ts**
   - Added guard to prevent auto-start when imported
   - Exported routers for potential future use

## Next Steps

- Document deployment patterns for production
- Add environment variable validation
- Create example .env files
- Add integration tests for proxy chain
- Document how to swap different agent implementations
