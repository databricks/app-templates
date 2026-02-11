# Agent Development Guide

## MANDATORY First Actions

**Ask the user interactively:**

1. **App deployment target:**
   > "Do you have an existing Databricks app you want to deploy to, or should we create a new one? If existing, what's the app name?"

   *Note: New apps should use the `agent-*` prefix (e.g., `agent-data-analyst`) unless the user specifies otherwise.*

2. **Lakebase instance (required for memory):**
   > "This template requires Lakebase for memory. Do you have an existing Lakebase instance? If so, what's the instance name?"

**Then check authentication status by running `databricks auth profiles`.**

This helps you understand:
- Which Databricks profiles are configured
- Whether authentication is already set up
- Which profile to use for subsequent commands

If no profiles exist or `.env` is missing, guide the user through running `uv run quickstart` to set up authentication and configuration. See the **quickstart** skill for details.

## Understanding User Goals

**Ask the user questions to understand what they're building:**

1. **What is the agent's purpose?** (e.g., data analyst assistant, customer support, code helper)
2. **What data or tools does it need access to?**
   - Databases/tables (Unity Catalog)
   - Documents for RAG (Vector Search)
   - Natural language data queries (Genie Spaces)
   - External APIs or services
3. **Any specific Databricks resources they want to connect?**

Use `uv run discover-tools` to show them available resources in their workspace, then help them select the right ones for their use case. **See the `add-tools` skill for how to connect tools and grant permissions.**

## Memory Template Note

This template includes **short-term memory** (conversation history within a session). The agent remembers what was said earlier in the same conversation thread.

**Required setup:**
1. Configure Lakebase instance (see **lakebase-setup** skill)
2. Use `thread_id` in requests to maintain conversation context (see **agent-memory** skill)

## Handling Deployment Errors

**If `databricks bundle deploy` fails with "An app with the same name already exists":**

Ask the user: "I see there's an existing app with the same name. Would you like me to bind it to this bundle so we can manage it, or delete it and create a new one?"

- **If they want to bind**: See the **deploy** skill for binding steps
- **If they want to delete**: Run `databricks apps delete <app-name>` then deploy again

---

## Available Skills

**Before executing any task, read the relevant skill file in `.claude/skills/`** - they contain tested commands, patterns, and troubleshooting steps.

| Task | Skill | Path |
|------|-------|------|
| Setup, auth, first-time | **quickstart** | `.claude/skills/quickstart/SKILL.md` |
| Lakebase configuration | **lakebase-setup** | `.claude/skills/lakebase-setup/SKILL.md` |
| Memory patterns | **agent-memory** | `.claude/skills/agent-memory/SKILL.md` |
| Find tools/resources | **discover-tools** | `.claude/skills/discover-tools/SKILL.md` |
| Deploy to Databricks | **deploy** | `.claude/skills/deploy/SKILL.md` |
| Add tools & permissions | **add-tools** | `.claude/skills/add-tools/SKILL.md` |
| Run/test locally | **run-locally** | `.claude/skills/run-locally/SKILL.md` |
| Modify agent code | **modify-agent** | `.claude/skills/modify-agent/SKILL.md` |

**Note:** All agent skills are located in `.claude/skills/` directory.

---

## Quick Commands

| Task | Command |
|------|---------|
| Setup | `uv run quickstart` |
| Discover tools | `uv run discover-tools` |
| Run locally | `uv run start-app` |
| Deploy | `databricks bundle deploy && databricks bundle run agent_langgraph_short_term_memory` |
| View logs | `databricks apps logs <app-name> --follow` |

---

## Key Files

| File | Purpose |
|------|---------|
| `agent_server/agent.py` | Agent logic, model, instructions, MCP servers, memory setup |
| `agent_server/start_server.py` | FastAPI server + MLflow setup |
| `agent_server/evaluate_agent.py` | Agent evaluation with MLflow scorers |
| `databricks.yml` | Bundle config & resource permissions |
| `scripts/quickstart.py` | One-command setup script |
| `scripts/discover_tools.py` | Discovers available workspace resources |

---

## Agent Framework Capabilities

> **IMPORTANT:** When adding any tool to the agent, you MUST also grant permissions in `databricks.yml`. See the **add-tools** skill for required steps and examples.

**Tool Types:**
1. **Unity Catalog Function Tools** - SQL UDFs managed in UC with built-in governance
2. **Agent Code Tools** - Defined directly in agent code for REST APIs and low-latency operations
3. **MCP Tools** - Interoperable tools via Model Context Protocol (Databricks-managed, external, or self-hosted)

**Built-in Tools:**
- **system.ai.python_exec** - Execute Python code dynamically within agent queries (code interpreter)

**Common Patterns:**
- **Structured data retrieval** - Query SQL tables/databases
- **Unstructured data retrieval** - Document search and RAG via Vector Search
- **Code interpreter** - Python execution for analysis via system.ai.python_exec
- **External connections** - Integrate services like Slack via HTTP connections

Reference: https://docs.databricks.com/aws/en/generative-ai/agent-framework/
