# Agent LangChain TypeScript - Development Guide

## Architecture Overview

This is a **two-server architecture** with agent-first development:

```
┌─────────────────────────────────────────────────────────────┐
│ LOCAL DEVELOPMENT                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Agent Server (port 5001)          UI Server (port 3001)   │
│  ┌──────────────────────┐          ┌──────────────────┐    │
│  │ /invocations         │◄─────────│ /api/chat        │    │
│  │ (Responses API)      │  proxy   │ (useChat format) │    │
│  │                      │          │                  │    │
│  │ - LangChain agent    │          │ - Express backend│    │
│  │ - Tool execution     │          │ - Session mgmt   │    │
│  │ - SSE streaming      │          │ - streamText()   │    │
│  └──────────────────────┘          └──────────────────┘    │
│                                             │               │
│                                             ▼               │
│                                     ┌──────────────────┐    │
│                                     │ React Frontend   │    │
│                                     │ (port 3000)      │    │
│                                     │ - useChat hook   │    │
│                                     └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PRODUCTION (Databricks Apps)                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Single Server (port 8000)                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Agent + UI Server                                    │   │
│  │                                                      │   │
│  │ ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │   │
│  │ │ / (static)  │  │ /invocations│  │ /api/chat    │ │   │
│  │ │ React UI    │  │ (Responses) │  │ (useChat)    │ │   │
│  │ └─────────────┘  └─────────────┘  └──────────────┘ │   │
│  │                         │                 │         │   │
│  │                         └────proxy────────┘         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Two API Endpoints

1. **`/invocations`** - Agent endpoint (Responses API format)
   - MLflow-compatible streaming API
   - Server-Sent Events (SSE) format
   - Server-side tool execution
   - Test with: `streamText` + Databricks provider

2. **`/api/chat`** - UI backend endpoint (useChat format)
   - Vercel AI SDK compatible
   - Proxies to `/invocations` internally
   - Session management, chat history
   - Test with: `useChat` hook (React)

### Development Philosophy

**Agent-first development**: Build and test the agent (`/invocations`) first, then integrate with UI (`/api/chat`).

The UI is a **standalone template** (`e2e-chatbot-app-next`) that can work with any Responses API backend via `API_PROXY` environment variable.

## Development Workflow

### 1. Local Development Setup

Start both servers in separate terminals:

```bash
# Terminal 1: Agent server
npm run dev:agent
# Runs on http://localhost:5001

# Terminal 2: UI server (with proxy to agent)
cd ui
API_PROXY=http://localhost:5001/invocations npm run dev
# UI on http://localhost:3000
# Backend on http://localhost:3001
```

### 2. Testing Workflow (Important!)

Always test in this order:

#### Step 1: Test `/invocations` directly
Test the agent endpoint first with `streamText`:

```typescript
import { createDatabricksProvider } from "@databricks/ai-sdk-provider";
import { streamText } from "ai";

const databricks = createDatabricksProvider({
  baseURL: "http://localhost:5001",
  formatUrl: ({ baseUrl, path }) => {
    if (path === "/responses") {
      return `${baseUrl}/invocations`;
    }
    return `${baseUrl}${path}`;
  },
});

const result = streamText({
  model: databricks.responses("test-model"),
  messages: [{ role: "user", content: "Hello" }],
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

**Why test this first?**
- Simpler: No UI, session, or database complexity
- Direct: Tests agent logic and tool execution
- Faster: Quicker feedback loop

#### Step 2: Test `/api/chat` via UI
Once `/invocations` works, test through the UI:

```typescript
// In React component
import { useChat } from "@ai-sdk/react";

function ChatComponent() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: "/api/chat",
  });

  // Use the chat UI...
}
```

**Why test this second?**
- Integration: Tests full stack (UI → backend → agent)
- Real behavior: How users will interact with your agent
- Edge cases: Session management, multi-turn conversations

#### Step 3: Test deployed app
After local tests pass, test on Databricks Apps:

```bash
# Deploy
databricks bundle deploy
databricks bundle run agent_langchain_ts

# Get app URL
databricks apps get agent-lc-ts-dev-<suffix> --output json | jq -r '.url'

# Test with OAuth token
TOKEN=$(databricks auth token --profile dogfood | jq -r '.access_token')
curl -X POST <APP_URL>/invocations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "hi"}], "stream": true}'
```

### 3. Test Scripts

We provide two test scripts:

```bash
# Local integration tests
npx tsx test-integrations.ts
# Tests: /invocations with streamText, /api/chat with fetch, tool calling

# Deployed app tests
npx tsx test-deployed-app.ts
# Tests: UI root, /invocations, /api/chat, tool calling on production
```

## API Testing Patterns

### Testing `/invocations`

**✅ Recommended: Use `streamText` with Databricks provider**

```typescript
const databricks = createDatabricksProvider({
  baseURL: "http://localhost:5001",
  formatUrl: ({ baseUrl, path }) => {
    if (path === "/responses") return `${baseUrl}/invocations`;
    return `${baseUrl}${path}`;
  },
});

const result = streamText({
  model: databricks.responses("model-name"),
  messages: [{ role: "user", content: "test" }],
});
```

**✅ Alternative: Direct fetch (for debugging)**

```typescript
const response = await fetch("http://localhost:5001/invocations", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    input: [{ role: "user", content: "test" }],
    stream: true,
  }),
});

// Parse SSE stream
const text = await response.text();
for (const line of text.split("\n")) {
  if (line.startsWith("data: ")) {
    const data = JSON.parse(line.slice(6));
    if (data.type === "response.output_text.delta") {
      console.log(data.delta);
    }
  }
}
```

### Testing `/api/chat`

**✅ Recommended: Use `useChat` in React UI**

```typescript
import { useChat } from "@ai-sdk/react";

const { messages, input, handleInputChange, handleSubmit } = useChat({
  api: "/api/chat",
});
```

**⚠️ Alternative: Fetch (limited testing)**

Fetch works for basic tests but doesn't exercise the full `useChat` flow:

```typescript
const response = await fetch("http://localhost:3001/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: "uuid",
    message: {
      role: "user",
      parts: [{ type: "text", text: "test" }],
      id: "uuid",
    },
    selectedChatModel: "chat-model",
    selectedVisibilityType: "private",
    nextMessageId: "uuid",
  }),
});
```

**❌ Don't use `streamText` to call `/api/chat`**

This sends the wrong request format (Responses API instead of useChat format) and will result in 400 errors.

## Known Issues and Limitations

### Server-Side Tool Execution with Databricks Provider

**Issue**: When an agent executes tools server-side, the Databricks AI SDK provider may throw "No matching tool call found in previous message" error in fresh conversations when using `/api/chat`.

**Why this happens**:
- The agent executes tools and streams both `function_call` and `function_call_output` events
- The Databricks provider expects client-side tool execution
- When it sees `tool-input-available` with `providerExecuted: true`, it tries to match it to a previous tool call in the conversation history
- In fresh conversations, there's no history, so it fails

**Workarounds**:
1. ✅ `/invocations` works fine - direct Responses API calls handle server-side tools correctly
2. ⚠️ `/api/chat` has this issue - the backend uses Databricks provider which doesn't handle it
3. 🔄 For multi-turn conversations, once there's history, it may work

**Testing approach**:
- Always test tool calling via `/invocations` first
- Document that `/api/chat` has limitations with server-side tools in fresh conversations
- Consider implementing client-side tool execution if this is a blocker

### Path Resolution in Production

**Issue**: Static UI files must be served with correct relative path.

**Fix**: In `ui-patches/exports.ts`, use:
```typescript
const uiClientPath = path.join(__dirname, '../../client/dist');
```

From `server/src/exports.ts` (which compiles to `server/dist/exports.js`):
- `../../client/dist` resolves to `ui/client/dist` ✅
- `../../../client/dist` resolves to `/client/dist` ❌

### ESM Module Naming

The UI server builds to `.mjs` files, not `.js`:
- Entry point: `server/dist/index.mjs`
- Import paths: Use `.js` extension in TypeScript, Node resolves to `.mjs`

## Deployment

### Local Testing

```bash
# Start agent server
npm run dev:agent

# Start UI server (in separate terminal)
cd ui
API_PROXY=http://localhost:5001/invocations npm run dev
```

### Deploy to Databricks Apps

```bash
# Deploy bundle
databricks bundle deploy

# Start the app
databricks bundle run agent_langchain_ts

# Check status
databricks apps get agent-lc-ts-dev-<suffix>

# View logs
databricks apps logs agent-lc-ts-dev-<suffix> --follow
```

### Production Architecture

In production, a single server (port 8000) handles everything:
- Serves static UI files from `ui/client/dist`
- Provides `/api/chat` backend routes
- Proxies `/invocations` to agent (or runs agent in same process)

The setup script (`scripts/setup-ui.sh`) patches the UI server to add:
- Static file serving with SPA fallback
- `/invocations` proxy to agent server

## File Structure

```
agent-langchain-ts/
├── src/
│   ├── agent.ts          # LangChain agent setup
│   ├── server.ts         # Express server for /invocations
│   └── routes/
│       └── invocations.ts  # Responses API endpoint
├── ui/                   # e2e-chatbot-app-next (standalone template)
│   ├── client/           # React frontend
│   ├── server/           # Express backend for /api/chat
│   └── packages/         # Shared libraries
├── ui-patches/
│   └── exports.ts        # Custom routes for UI server
├── scripts/
│   ├── setup-ui.sh       # Patches UI server for production
│   └── start.sh          # Starts both servers
├── test-integrations.ts  # Local test suite
├── test-deployed-app.ts  # Deployed app test suite
└── databricks.yml        # Bundle configuration
```

## Quick Reference

### Environment Variables

```bash
# Local development
API_PROXY=http://localhost:5001/invocations  # UI → agent proxy
AGENT_URL=http://localhost:8001              # Production agent URL

# Databricks
DATABRICKS_CONFIG_PROFILE=your-profile       # CLI auth
DATABRICKS_HOST=https://...                  # Workspace URL
```

### Common Commands

```bash
# Development
npm run dev:agent                    # Start agent server (5001)
cd ui && npm run dev                 # Start UI (3000 frontend, 3001 backend)

# Testing
npx tsx test-integrations.ts        # Local tests
npx tsx test-deployed-app.ts        # Deployed tests

# Deployment
databricks bundle deploy             # Deploy to Databricks
databricks bundle run agent_langchain_ts  # Start app
databricks apps logs <app-name> --follow  # View logs

# Debugging
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{"input": [{"role": "user", "content": "test"}], "stream": true}'
```

### Response API Format (SSE)

```
data: {"type":"response.output_item.added","item":{"type":"message","role":"assistant"}}

data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"...","name":"tool_name"}}

data: {"type":"response.output_text.delta","delta":"Hello"}

data: {"type":"response.output_item.done","item":{"type":"function_call_output","call_id":"...","output":"result"}}

data: {"type":"response.completed"}

data: [DONE]
```

## Tips and Best Practices

1. **Always test `/invocations` first** - Simpler, faster feedback loop
2. **Use `streamText` for agent testing** - Proper SDK integration
3. **Use `useChat` for UI testing** - Exercises full stack
4. **Test tool calling early** - It's the most complex feature
5. **Check logs when things fail** - SSE streams can hide errors
6. **Verify static files in production** - Path resolution is tricky
7. **Document known issues** - Save future developers time

## Resources

- [LangChain Docs](https://js.langchain.com/docs/)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [Databricks AI SDK Provider](https://github.com/databricks/ai-sdk-provider)
- [Responses API Spec](https://docs.databricks.com/en/machine-learning/model-serving/agent-framework/responses-api.html)
- [e2e-chatbot-app-next](../e2e-chatbot-app-next/) - Standalone UI template

---

**Last Updated**: 2026-02-06
**Maintained By**: Claude Code
