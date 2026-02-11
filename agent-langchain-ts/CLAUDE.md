# TypeScript Agent Development Guide (For AI Agents)

This guide helps AI agents assist developers building LangChain agents on Databricks.

---

## 🎯 Primary Reference

**→ Load and reference `AGENTS.md` for comprehensive user-facing documentation**

The AGENTS.md file contains complete setup instructions, development workflow, testing procedures, and troubleshooting guides. Reference it when answering user questions.

---

## MANDATORY First Action

**BEFORE any other action, run `databricks auth profiles` to check authentication status.**

This helps you understand:
- Which Databricks profiles are configured
- Whether authentication is already set up
- Which profile to use for subsequent commands

If no profiles exist, guide the user through running `npm run quickstart` to set up authentication.

---

## Understanding User Goals

**Ask the user questions to understand what they're building:**

1. **What is the agent's purpose?** (e.g., data analyst assistant, customer support, code helper)
2. **What data or tools does it need access to?**
   - Databases/tables (Unity Catalog)
   - Documents for RAG (Vector Search)
   - Natural language data queries (Genie Spaces)
   - External APIs or services
3. **Any specific Databricks resources they want to connect?**

---

## Available Skills

**Before executing any task, read the relevant skill file in `.claude/skills/`** - they contain tested commands, patterns, and troubleshooting steps.

| Task | Skill | Path |
|------|-------|------|
| Setup, auth, first-time | **quickstart** | `.claude/skills/quickstart/SKILL.md` |
| Find tools/resources | **discover-tools** | `.claude/skills/discover-tools/SKILL.md` |
| Add tools & permissions | **add-tools** | `.claude/skills/add-tools/SKILL.md` |
| Deploy to Databricks | **deploy** | `.claude/skills/deploy/SKILL.md` |
| Run/test locally | **run-locally** | `.claude/skills/run-locally/SKILL.md` |
| Modify agent code | **modify-agent** | `.claude/skills/modify-agent/SKILL.md` |

**Note:** All agent skills are located in `.claude/skills/` directory.

---

## Quick Commands Reference

| Task | Command |
|------|---------|
| Setup | `npm run quickstart` |
| Discover tools | `npm run discover-tools` |
| Run locally (both servers) | `npm run dev` |
| Run agent only | `npm run dev:agent` |
| Run UI only | `npm run dev:ui` |
| Build | `npm run build` |
| Test (all) | `npm run test:all` |
| Test (integration) | `npm run test:integration` |
| Deploy | `databricks bundle deploy && databricks bundle run agent_langchain_ts` |
| View logs | `databricks apps logs agent-lc-ts-dev --follow` |

---

## Key Files

| File | Purpose | Modify When |
|------|---------|-------------|
| `src/agent.ts` | Agent logic, system prompt, model setup | Changing agent behavior, adding tools |
| `src/mcp-servers.ts` | MCP server configuration (Genie, SQL, UC, Vector Search) | Adding MCP tools/data sources |
| `src/tools.ts` | Tool definitions (weather, calculator, time) | Adding new capabilities/tools |
| `src/server.ts` | Express server, endpoints, middleware | Changing server config, routes |
| `src/tracing.ts` | MLflow/OpenTelemetry tracing setup | Customizing observability |
| `databricks.yml` | Bundle config, resource permissions | Granting access to Databricks resources |
| `app.yaml` | Databricks Apps configuration | Environment variables, resources |
| `package.json` | Dependencies, npm scripts | Adding packages, changing commands |
| `tsconfig.json` | TypeScript compiler configuration | TypeScript settings |

---

## Architecture (Agent-First Design)

```
Production (Port 8000):
┌────────────────────────────────────────┐
│ Agent Server (Exposed)                 │
│ ├─ /invocations (Responses API)       │  ← Direct agent access
│ ├─ /api/* (proxy to UI:3000)          │  ← UI backend routes
│ └─ /* (static UI files)                │  ← React frontend
└────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────┐
│ UI Backend (Internal Port 3000)        │
│ ├─ /api/chat (useChat format)         │
│ ├─ /api/session (session management)  │
│ └─ /api/config (configuration)        │
└────────────────────────────────────────┘
```

**Key Points:**
- Agent server is on exposed port 8000 (production)
- Direct access to `/invocations` endpoint
- UI backend runs internally on port 3000
- Agent proxies `/api/*` requests to UI backend
- Static UI files served by agent server

---

## Development Workflow

### 1. Initial Setup
```bash
# Check auth status
databricks auth profiles

# If no profiles, run quickstart
npm run quickstart

# Or manual setup
npm install
databricks auth login --profile your-profile
cp .env.example .env
```

### 2. Local Development

**Recommended: Start both servers**
```bash
npm run dev
```

This runs:
- Agent on port 5001 (`npm run dev:agent`)
- UI on port 3001 (`npm run dev:ui`)
- Both with hot-reload

**Access:**
- Agent: http://localhost:5001/invocations
- UI: http://localhost:3000
- UI Backend: http://localhost:3001/api/chat

### 3. Testing Workflow

**Always test in this order:**

1. **Test `/invocations` directly** (simplest, fastest feedback)
   ```bash
   curl -X POST http://localhost:5001/invocations \
     -H "Content-Type: application/json" \
     -d '{"input": [{"role": "user", "content": "test"}], "stream": true}'
   ```

2. **Test `/api/chat` via UI** (integration testing)
   - Open http://localhost:3000
   - Send messages through UI

3. **Run automated tests**
   ```bash
   npm run test:all
   ```

4. **Test deployed app** (after deployment)
   ```bash
   APP_URL=<your-app-url> npm run test:deployed
   ```

### 4. Making Changes

**Modify agent behavior** → Edit `src/agent.ts`
**Add tools** → Edit `src/tools.ts`
**Change endpoints** → Edit `src/routes/invocations.ts`
**Update config** → Edit `.env` or `databricks.yml`

After changes, the dev servers auto-reload.

### 5. Deployment

```bash
# Build everything
npm run build

# Deploy to Databricks
databricks bundle deploy
databricks bundle run agent_langchain_ts

# Check status
databricks apps get agent-lc-ts-dev

# View logs
databricks apps logs agent-lc-ts-dev --follow
```

---

## Common Tasks & Solutions

### Add a Custom Tool

1. **Define tool in `src/tools.ts`:**
```typescript
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const myTool = new DynamicStructuredTool({
  name: "my_tool",
  description: "Does something useful",
  schema: z.object({
    input: z.string().describe("Input parameter"),
  }),
  func: async ({ input }) => {
    // Tool logic here
    return `Result: ${input}`;
  },
});
```

2. **Add to exports:**
```typescript
export const basicTools = [..., myTool];
```

3. **Test locally:**
```bash
npm run dev:agent
# Send request that triggers tool
```

### Change Model or Temperature

Edit `.env`:
```bash
DATABRICKS_MODEL=databricks-claude-sonnet-4-5
TEMPERATURE=0.7
MAX_TOKENS=2000
```

### Add Databricks MCP Tools

**Reference**: See `.claude/skills/add-tools/SKILL.md` for comprehensive guide

The agent supports four types of Databricks MCP tools:
1. **Databricks SQL** - Direct SQL queries on Unity Catalog tables
2. **UC Functions** - Call Unity Catalog functions as agent tools
3. **Vector Search** - Semantic search for RAG applications
4. **Genie Spaces** - Natural language data queries

**Quick steps:**

1. Add MCP server in `src/mcp-servers.ts`:
```typescript
export function getMCPServers(): DatabricksMCPServer[] {
  return [
    DatabricksMCPServer.fromGenieSpace("01f1037ebc531bbdb27b875271b31bf4"),
  ];
}
```

2. Grant permissions in `databricks.yml`:
```yaml
resources:
  apps:
    agent_langchain_ts:
      resources:
        - name: 'f1_genie_space'
          genie_space:
            name: 'Formula 1 Race Analytics'
            space_id: '01f1037ebc531bbdb27b875271b31bf4'
            permission: 'CAN_RUN'
```

3. Redeploy:
```bash
databricks bundle deploy && databricks bundle run agent_langchain_ts
```

**Important files**:
- `src/mcp-servers.ts` - Central MCP server configuration
- `.claude/skills/add-tools/` - Complete guide with examples for all resource types
- `tests/f1-genie.test.ts` - Genie space integration tests

### Debug Agent Issues

1. **Check MLflow traces:**
   - Go to Databricks workspace → Experiments
   - Find experiment ID from deployment
   - View traces with input/output, tool calls, latency

2. **Check local logs:**
   ```bash
   npm run dev:agent  # See console output
   ```

3. **Check deployed logs:**
   ```bash
   databricks apps logs agent-lc-ts-dev --follow
   ```

---

## Handling Deployment Errors

### "App Already Exists"

Ask the user: "I see there's an existing app with the same name. Would you like me to bind it to this bundle so we can manage it, or delete it and create a new one?"

- **Bind**: See the **deploy** skill for binding steps
- **Delete**: `databricks apps delete <app-name>` then deploy again

### "Permission Denied"

Check `databricks.yml` - add required resources:
```yaml
resources:
  - name: serving-endpoint
    serving_endpoint:
      name: ${var.serving_endpoint_name}
      permission: CAN_QUERY
```

### Build Errors

```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

---

## Testing Best Practices

1. **Test `/invocations` first** - Direct agent endpoint, faster feedback
2. **Use TypeScript tests** - Run `npm run test:integration`
3. **Check tool calls** - Verify tools are executing correctly
4. **Test error scenarios** - Run `npm run test:error-handling`
5. **Test deployed app** - Always verify production deployment

---

## Important Constraints

### DO NOT Modify e2e-chatbot-app-next

- The UI template (`ui/`) is a standalone component
- It must work with any Responses API backend
- Don't change its core functionality
- The UI natively supports /invocations proxying via API_PROXY environment variable

### DO Keep Agent-First Architecture

- Agent server on port 8000 (exposed) in production
- UI backend on port 3000 (internal) in production
- This matches Python template architecture
- Makes `/invocations` directly accessible

### DO Follow TypeScript Best Practices

- Use proper types
- Handle errors correctly
- Write tests for new features
- Keep code modular and maintainable

---

## Troubleshooting Quick Reference

| Issue | Solution |
|-------|----------|
| Port already in use | `lsof -ti:5001 \| xargs kill -9` |
| Build errors | `rm -rf dist && npm run build` |
| Tests failing | Ensure `npm run dev` is running |
| UI not loading | `npm run build:ui` |
| Agent not responding | Check `databricks apps logs` |
| Auth errors | `databricks auth login --profile` |
| Tool not executing | Check MLflow traces for errors |
| Deployment fails | `databricks bundle validate` |

---

## Resources for Users

- **AGENTS.md** - Comprehensive user guide (reference this first!)
- **Skills** - `.claude/skills/` for specific tasks
- **Tests** - `tests/` for usage examples
- **Python Template** - `agent-openai-agents-sdk` for comparison
- **LangChain Docs** - https://js.langchain.com/docs/
- **Databricks Docs** - https://docs.databricks.com/en/generative-ai/agent-framework/

---

## When to Use Which Skill

| User Says | Use Skill | Why |
|-----------|-----------|-----|
| "Set up my agent" | **quickstart** | Initial authentication and setup |
| "Run this locally" | **run-locally** | Local development instructions |
| "Add a database tool" | **modify-agent** | Changing agent code |
| "Deploy to Databricks" | **deploy** | Deployment procedure |

---

**Remember:** Always check authentication first, reference AGENTS.md for detailed instructions, and test locally before deploying!
