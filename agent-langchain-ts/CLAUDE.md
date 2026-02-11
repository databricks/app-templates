@AGENTS.md

<!-- This loads the user-facing documentation from AGENTS.md -->

---

# AI Agent Assistant Guide

This section provides additional context for AI coding assistants helping users with this template.

## MANDATORY First Action

**BEFORE any other action, run `databricks auth profiles` to check authentication status.**

This helps you understand:
- Which Databricks profiles are configured
- Whether authentication is already set up
- Which profile to use for subsequent commands

If no profiles exist, guide the user through running `npm run quickstart` to set up authentication.

## Understanding User Goals

**Ask the user questions to understand what they're building:**

1. **What is the agent's purpose?** (e.g., data analyst assistant, customer support, code helper)
2. **What data or tools does it need access to?**
   - Databases/tables (Unity Catalog)
   - Documents for RAG (Vector Search)
   - Natural language data queries (Genie Spaces)
   - External APIs or services
3. **Any specific Databricks resources they want to connect?**

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

## Key Implementation Details

### Agent Architecture

The agent uses standard LangGraph `createReactAgent` API:
- Automatic tool calling and execution
- Built-in agentic loop with reasoning
- Streaming support out of the box
- Compatible with MCP tools

**Main files:**
- `src/agent.ts` - Agent creation using `createReactAgent`
- `src/tools.ts` - Basic tool definitions (weather, calculator, time)
- `src/mcp-servers.ts` - MCP server configuration (code-based, not env vars)
- `src/server.ts` - Express server with /invocations endpoint
- `databricks.yml` - Resource permissions
- `app.yaml` - Databricks Apps configuration

### MCP Tool Configuration

**IMPORTANT:** MCP tools are configured in `src/mcp-servers.ts`, NOT environment variables.

```typescript
// src/mcp-servers.ts
export function getMCPServers(): DatabricksMCPServer[] {
  return [
    // Add your MCP servers here
    DatabricksMCPServer.fromGenieSpace("space-id"),
  ];
}
```

See `.claude/skills/add-tools/SKILL.md` for complete examples.

### Testing Workflow

Always test in this order:
1. Test `/invocations` directly (simplest, fastest feedback)
2. Test `/api/chat` via UI (integration testing)
3. Run automated tests: `npm run test:all`
4. Test deployed app: `APP_URL=<url> npm run test:deployed`

### Common Issues

**"App Already Exists":**
Ask: "I see there's an existing app with the same name. Would you like me to bind it to this bundle so we can manage it, or delete it and create a new one?"

**Permission Errors:**
Check `databricks.yml` - add required resources with appropriate permissions. See the **add-tools** skill.

**Build Errors:**
```bash
rm -rf dist node_modules
npm install
npm run build
```

## When to Use Which Skill

| User Says | Use Skill | Why |
|-----------|-----------|-----|
| "Set up my agent" | **quickstart** | Initial authentication and setup |
| "Run this locally" | **run-locally** | Local development instructions |
| "Add a database tool" | **add-tools** | Adding MCP tools and permissions |
| "Deploy to Databricks" | **deploy** | Deployment procedure |
| "Change the prompt" | **modify-agent** | Modifying agent behavior |

---

**Remember:** Always check authentication first, reference AGENTS.md for detailed user-facing instructions, and test locally before deploying!
