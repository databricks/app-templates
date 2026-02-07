# New TypeScript Agent Template with LangChain

## Overview

This PR introduces a new **TypeScript agent template** for building Databricks agents using LangChain. It provides a complete, production-ready foundation for TypeScript developers to build conversational AI agents that integrate seamlessly with Databricks Apps and the e2e-chatbot-app-next UI.

## Key Features

### 🎯 Agent Implementation
- **LangChain Integration**: Full-featured agent using LangChain.js with structured tool calling
- **MLflow Tracing**: Automatic trace capture and logging for debugging and monitoring
- **Built-in Tools**: Weather, calculator, and time tools with extensible architecture
- **Responses API**: MLflow-compatible `/invocations` endpoint with proper SSE streaming

### 🏗️ Architecture Highlights

**Two-Server Architecture (Local Dev)**
```
Agent Server (port 5001)          UI Server (port 3001)
┌──────────────────────┐          ┌──────────────────┐
│ /invocations         │◄─────────│ /api/chat        │
│ (Responses API)      │  proxy   │ (useChat format) │
│ - LangChain agent    │          │ - streamText()   │
│ - Server-side tools  │          │ - Session mgmt   │
└──────────────────────┘          └──────────────────┘
```

**Single-Server Production (Databricks Apps)**
- Agent serves static UI files + provides both `/invocations` and `/api/chat`
- Automatic OAuth authentication
- Resource permissions managed via DAB (Databricks Asset Bundles)

### 🧪 Comprehensive Testing

**Test Scripts:**
1. `test-integrations.ts` - Local integration tests (all endpoints + tool calling)
2. `test-deployed-app.ts` - Deployed app validation (OAuth, UI, APIs, tools)
3. Jest unit tests for agent logic, endpoints, and useChat integration

**Coverage:**
- ✅ `/invocations` endpoint (Responses API format)
- ✅ `/api/chat` endpoint (useChat format)
- ✅ Server-side tool execution with proper event sequences
- ✅ UI static file serving
- ✅ Both local and deployed environments

### 📚 Documentation

**Comprehensive Guides:**
- `CLAUDE.md` - Development workflow, testing patterns, API sequences
- `README.md` - Quick start, architecture, deployment
- `.claude/skills/` - Reusable skills for common tasks (deploy, run, modify)
- Architecture diagrams and troubleshooting guides

## Technical Deep Dive

### Critical Fix: Responses API Event Sequences

The biggest technical challenge was getting server-side tool execution to work with the Databricks AI SDK provider. The solution required emitting **both** `.added` and `.done` events with matching `call_id` values:

**Proper Event Sequence:**
```typescript
1. response.output_item.added (type: function_call, call_id: X)
2. response.output_item.done (type: function_call, call_id: X)
3. response.output_item.added (type: function_call_output, call_id: X)
4. response.output_item.done (type: function_call_output, call_id: X)
```

**Why This Matters:**
- The Databricks provider uses `.added` events to register items internally
- It then matches `.done` events and outputs using the `call_id`
- Without `.added` events → "No matching tool call found" errors
- With proper sequences → Both `/invocations` and `/api/chat` work perfectly

**Inspiration from Python:**
By studying `agent-openai-agents-sdk`, we discovered that the OpenAI Agents SDK already emits these proper sequences as `raw_response_event` types. The Python code just passes them through. Our TypeScript implementation manually constructs these events from LangChain's event stream.

### UI Integration

**Clean Separation:**
- The agent is completely independent and works standalone via `/invocations`
- UI integration is optional via the `API_PROXY` environment variable
- UI template (`e2e-chatbot-app-next`) remains generic and reusable
- Static file serving patched via `ui-patches/exports.ts` (injected, not modified)

**Production Setup:**
```bash
scripts/setup-ui.sh  # Copies exports.ts and patches UI server
start.sh             # Starts both servers with proper routing
```

## File Structure

```
agent-langchain-ts/
├── src/
│   ├── agent.ts              # LangChain agent setup (252 lines)
│   ├── tools.ts              # Tool definitions (233 lines)
│   ├── tracing.ts            # MLflow tracing (234 lines)
│   ├── server.ts             # Express server (198 lines)
│   └── routes/
│       ├── invocations.ts    # Responses API endpoint (230 lines) ⭐
│       └── ui-backend.ts     # UI proxy routes (114 lines)
├── tests/                    # Jest unit tests
├── test-integrations.ts      # Local test suite (226 lines)
├── test-deployed-app.ts      # Deployed test suite (321 lines)
├── ui-patches/exports.ts     # UI server customization (83 lines)
├── scripts/
│   ├── setup-ui.sh           # UI setup automation
│   └── quickstart.ts         # Interactive setup wizard
├── CLAUDE.md                 # Development guide (461 lines) ⭐
├── databricks.yml            # Bundle configuration
└── .claude/skills/           # Reusable development skills
```

## Testing This PR

### Local Testing
```bash
# Terminal 1: Start agent server
npm run dev:agent

# Terminal 2: Start UI server
cd ui && API_PROXY=http://localhost:5001/invocations npm run dev

# Terminal 3: Run tests
npx tsx test-integrations.ts
```

### Deployed Testing
```bash
# Deploy
databricks bundle deploy
databricks bundle run agent_langchain_ts

# Test
npx tsx test-deployed-app.ts
```

**Expected Results:**
- ✅ All 8 tests pass (4 local + 4 deployed)
- ✅ Tool calling works in both fresh and multi-turn conversations
- ✅ UI loads and renders correctly
- ✅ `/invocations` and `/api/chat` both functional

## Migration Path

**For Existing Python Agent Developers:**
1. Keep your Python agent logic
2. Add TypeScript agent alongside for specific use cases
3. Both expose `/invocations` endpoint
4. Same UI works with either backend

**For New TypeScript Developers:**
1. Clone this template
2. Modify `src/agent.ts` and `src/tools.ts` for your use case
3. Test locally with `npm run dev:agent`
4. Deploy with `databricks bundle deploy`

## Dependencies

**Core:**
- `langchain` ^0.3.7 - Agent framework
- `@langchain/openai` ^0.3.15 - OpenAI models
- `@databricks/databricks-sdk` ^0.3.1 - Databricks SDK
- `mlflow` ^1.0.9 - Model tracing
- `express` ^5.0.1 - HTTP server
- `zod` ^3.24.1 - Schema validation

**No Changes to UI Template:**
- `e2e-chatbot-app-next/package.json` - Only name fix (adding `@`)
- `e2e-chatbot-app-next/package-lock.json` - Only 2 lines changed
- UI remains generic and reusable

## Breaking Changes

None - this is a new template that doesn't affect existing agents.

## Related Documentation

- [LangChain.js Docs](https://js.langchain.com/docs/)
- [Databricks Responses API](https://docs.databricks.com/en/machine-learning/model-serving/agent-framework/responses-api.html)
- [MLflow Python to TypeScript](https://mlflow.org/docs/latest/llms/langchain/guide/index.html)

## Future Enhancements

Potential improvements for future PRs:
- [ ] Add more example tools (database queries, file operations)
- [ ] Implement agent memory/conversation history
- [ ] Add multi-modal input support (images, files)
- [ ] Create agent evaluation framework with test cases
- [ ] Add performance benchmarking scripts
- [ ] Implement streaming token-by-token updates
- [ ] Add support for tool choice and parallel tool execution

## Checklist

- [x] Code follows TypeScript best practices
- [x] All tests pass locally and on deployed app
- [x] Documentation is comprehensive and up-to-date
- [x] No unnecessary changes to UI template
- [x] Responses API events follow proper sequences
- [x] MLflow tracing captures all operations
- [x] Bundle deploys successfully to Databricks Apps
- [x] Skills documented and tested

## Review Focus Areas

Please pay special attention to:

1. **Responses API Implementation** (`src/routes/invocations.ts`)
   - Event sequence correctness
   - Tool call tracking with `call_id` matching
   - SSE streaming format compliance

2. **Testing Coverage**
   - Are there edge cases we missed?
   - Should we add more tool examples?
   - Is the deployed app test suite comprehensive?

3. **Documentation Quality**
   - Is `CLAUDE.md` clear and actionable?
   - Are there confusing sections?
   - What's missing for a new developer?

4. **Architecture Decisions**
   - Two-server vs single-server trade-offs
   - UI integration approach
   - Tool definition patterns

---

**Summary**: This PR provides a complete, production-ready TypeScript agent template that matches the quality and functionality of our Python agent templates, with comprehensive testing, documentation, and Databricks integration.
