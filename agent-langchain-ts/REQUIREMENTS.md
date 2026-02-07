# TypeScript Agent Template - Requirements

## Project Goal

Create an agent-first TypeScript template that integrates with the e2e-chatbot-app-next UI while maintaining clean separation of concerns and independent development workflows.

## Key Requirements

### 1. Clean Contract Between Agent and UI

**Requirement:** Maintain a clear, stable API contract similar to the Python template.

- UI communicates with agent backend exclusively via `/invocations` endpoint
- No tight coupling between agent implementation and UI code
- e2e-chatbot-app-next must remain reusable across different backends

**Rationale:** e2e-chatbot-app-next serves chat UIs for various different backends, so it needs a standard interface.

### 2. Independent Development

**Requirement:** Enable independent iteration on both components.

- Developers can modify agent-langchain-ts without breaking e2e-chatbot-app-next
- Developers can modify e2e-chatbot-app-next without breaking agent-langchain-ts
- Changes to either component shouldn't require coordinated releases

**Rationale:** Multiple teams work on these components with different release cycles.

### 3. API_PROXY Mode Support

**Requirement:** Support e2e-chatbot-app-next's API_PROXY mode.

- UI can set `API_PROXY` environment variable to proxy requests through local backend
- When `API_PROXY=http://localhost:5001/invocations` is set, UI queries local agent
- Enables local development and testing workflow

**Implementation Detail:**
```typescript
// packages/ai-sdk-providers/src/providers-server.ts
formatUrl: ({ baseUrl, path }) => API_PROXY ?? `${baseUrl}${path}`
```

### 4. Agent-First Developer Experience

**Requirement:** Match Python template's developer workflow.

```bash
# Developer workflow
cd agent-langchain-ts
npm run dev  # UI auto-fetches, everything works
```

- Developer starts in agent-langchain-ts directory
- UI workspace auto-fetches (via setup script)
- Modify `src/agent.ts` to customize agent behavior
- Single command to run everything locally

### 5. Workspace Architecture

**Requirement:** Use npm workspaces for type safety and dependency management.

```json
{
  "workspaces": ["ui"]
}
```

**Setup script logic:**
1. Check if `./ui` exists → Done
2. Check if `../e2e-chatbot-app-next` exists → Symlink it (monorepo)
3. Otherwise → Clone from GitHub (standalone)

**Benefits:**
- Works standalone (clones UI from GitHub)
- Works in monorepo (symlinks sibling directory)
- Type safety across agent and UI
- Shared dependencies

### 6. /invocations Endpoint

**Requirement:** Provide MLflow-compatible Responses API endpoint.

**Contract:**
- **Request format:** Standard Responses API
  ```json
  {
    "input": [{"role": "user", "content": "..."}],
    "stream": true
  }
  ```

- **Response format:** Server-Sent Events with Responses API events
  ```
  data: {"type":"response.output_item.done","item":{...}}
  data: {"type":"response.output_text.delta","item_id":"...","delta":"..."}
  data: {"type":"response.completed"}
  data: [DONE]
  ```

**Implementation Status:** ✅ Already working perfectly

### 7. Architecture Comparison with Python

| Aspect | Python Template | TypeScript Template |
|--------|----------------|---------------------|
| **Entry Point** | `agent.py` | `agent.ts` |
| **UI Fetch** | Runtime clone | Setup script clone/symlink |
| **Contract** | `/invocations` endpoint | `/invocations` endpoint |
| **Type Safety** | None | Full TS types via workspace |
| **Single Dir** | ✅ Yes | ✅ Yes |
| **Auto UI** | ✅ Yes | ✅ Yes |

## Current Implementation Status

### ✅ Completed

1. **Workspace structure** - npm workspaces configured
2. **Setup script** (`scripts/setup-ui.sh`) - Auto-fetches/symlinks UI
3. **/invocations endpoint** - MLflow-compatible, Responses API format, streaming works
4. **Agent routes** - Invocations router using local agent
5. **Path handling** - Works in both dev and production modes
6. **Package names** - Fixed UI package.json to use valid scoped name

### ⚠️ In Progress

**UI Integration Challenge:**
- When importing bundled UI server code, it starts its own Express instance
- This conflicts with agent server trying to mount routes
- Need clean separation: agent serves `/invocations`, UI queries it

### 📋 Next Steps

**Recommended Approach:**

1. **Agent Server** (agent-langchain-ts):
   - Provide `/invocations` endpoint ✅ (already working)
   - Serve UI static files (HTML, CSS, JS)
   - No need to import UI's backend routes

2. **UI Configuration**:
   - Option A: UI backend sets `API_PROXY=http://localhost:5001/invocations`
   - Option B: UI frontend configured to query `/invocations` directly (if supported)

3. **Clean Contract:**
   ```
   ┌─────────────┐
   │ UI Frontend │ ──query──> /invocations
   └─────────────┘
                               ↓
                    ┌──────────────────────┐
                    │ Agent Server         │
                    │ - /invocations (API) │
                    │ - Static files (UI)  │
                    └──────────────────────┘
   ```

## Open Questions

1. **Does UI frontend support querying `/invocations` directly?**
   - Need to check if `useChat` can be configured to use `/invocations`
   - Or does it require the UI backend to proxy via `API_PROXY`?

2. **Which integration approach is preferred?**
   - Run UI backend with `API_PROXY` set
   - Configure UI frontend to query `/invocations` directly
   - Hybrid approach

## Critical API Requirements

### ✅ REQUIREMENT 1: Standalone UI Template
**`e2e-chatbot-app-next` must be deployable as a standalone application**

- Must build and deploy independently without agent code
- Should work with any backend implementing the required endpoints
- **DO NOT MODIFY** the UI template - it's shared across multiple agent implementations

### ✅ REQUIREMENT 2: Two-Server Architecture
**Agent and UI run as separate servers that communicate via `/invocations`**

**Architecture:**
1. **Agent Server** - Provides `/invocations` endpoint (Responses API)
2. **UI Server** - Provides `/api/chat`, `/api/session`, etc. (calls agent via `API_PROXY`)

**Why this matters:**
- The UI backend already has proper AI SDK implementation (`streamText` + `createUIMessageStream`)
- The agent provides `/invocations` in Responses API format
- The UI backend converts between formats using AI SDK
- **DO NOT try to implement `/api/chat` in the agent server!**

**Local Development:**
```bash
# Terminal 1: Agent server (port 5001)
npm run dev:agent

# Terminal 2: UI server (port 3001) with API_PROXY
cd ui && API_PROXY=http://localhost:5001/invocations npm run dev
```

**How it works:**
```
Browser → UI Frontend (3000) → UI Backend (3001) → Agent (5001)
                                /api/chat           /invocations
                                [AI SDK format]     [Responses API]
```

### ✅ REQUIREMENT 3: MLflow-Compatible /invocations
**`/invocations` must return Responses API formatted output**

The endpoint MUST:
- Follow OpenAI Responses API SSE format
- Return `response.output_text.delta` events for streaming
- Be compatible with MLflow model serving
- End with `response.completed` and `[DONE]`

**Test verification:**
```bash
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{"input":[{"role":"user","content":"Hello"}],"stream":true}'

# Should return:
# data: {"type":"response.output_text.delta","delta":"text"}
# data: {"type":"response.completed","response":{...}}
# data: [DONE]
```

## Success Criteria

- ✅ Developer clones agent-langchain-ts, runs `npm run dev`, everything works
- ✅ Developer can modify `src/agent.ts` and see changes immediately
- ✅ External clients can query `/invocations` endpoint (Responses API format)
- ✅ UI can query `/api/chat` and render responses correctly (AI SDK format)
- ✅ UI can be developed independently without breaking agent
- ✅ Agent can be developed independently without breaking UI
- ✅ Same developer experience as Python template
