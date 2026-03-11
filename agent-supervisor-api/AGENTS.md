# Agent Development Guide

## MANDATORY First Actions

**Ask the user interactively:**

1. **App deployment target:**
   > "Do you have an existing Databricks app you want to deploy to, or should we create a new one? If existing, what's the app name?"

   *Note: New apps should use the `agent-*` prefix (e.g., `agent-data-analyst`) unless the user specifies otherwise.*

**Then check authentication and profile configuration:**

1. Read the `.env` file to find `DATABRICKS_CONFIG_PROFILE` (e.g., `dev`)
2. Run `databricks auth profiles` to verify the profile is configured and valid

**CRITICAL: All `databricks` CLI commands must include the profile from `.env`.** Either use `--profile` or set the env var:

```bash
databricks <command> --profile <profile>
# or
DATABRICKS_CONFIG_PROFILE=<profile> databricks <command>
```

If no profiles exist or `.env` is missing, guide the user through running `uv run quickstart` to set up authentication and configuration.

## Understanding User Goals

**Ask the user questions to understand what they're building:**

1. **What is the agent's purpose?** (e.g., data analyst assistant, customer support, code helper)
2. **What data or tools does it need access to?**
   - Unity Catalog functions (SQL UDFs, Python UDFs)
   - Genie Spaces for natural language data queries
   - Agent endpoints for specialized sub-agents
   - External MCP servers via UC connections

Use `uv run discover-tools` to show available resources in their workspace, then help them select the right ones.

## Hosted Tool Types

The Supervisor API supports these tool types. Each is specified in the `TOOLS` list in `agent_server/agent.py`:

| Type | Description | Required keys |
|---|---|---|
| `uc_function` | Calls a UC function (SQL or Python UDF) | `name`, `name_alias`, `description` |
| `genie` | Queries a Genie space to answer data questions | `name`, `description`, `space_id` |
| `agent_endpoint` | Delegates to an existing agent endpoint | `name`, `description`, `endpoint_name` |
| `mcp` | Connects to an external MCP server via a UC connection | `name`, `description`, `connection_name` |

**For each tool added**, also add the corresponding resource permission in `databricks.yml`. See the **add-tools** skill for examples.

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
| Find tools/resources | **discover-tools** | `.claude/skills/discover-tools/SKILL.md` |
| Deploy to Databricks | **deploy** | `.claude/skills/deploy/SKILL.md` |
| Add tools & permissions | **add-tools** | `.claude/skills/add-tools/SKILL.md` |
| Run/test locally | **run-locally** | `.claude/skills/run-locally/SKILL.md` |
| Modify agent code | **modify-agent** | `.claude/skills/modify-agent/SKILL.md` |

---

## Quick Commands

| Task | Command |
|------|---------|
| Setup | `uv run quickstart` |
| Discover tools | `uv run discover-tools` |
| Run locally | `uv run start-app` |
| Deploy | `databricks bundle deploy && databricks bundle run agent_supervisor_api` |
| View logs | `databricks apps logs <app-name> --follow` |

---

## Key Files

| File | Purpose |
|------|---------|
| `agent_server/agent.py` | Model, tools list, invoke/stream handlers |
| `agent_server/start_server.py` | FastAPI server + MLflow setup |
| `databricks.yml` | Bundle config & resource permissions |
| `scripts/quickstart.py` | One-command setup script |
| `scripts/discover_tools.py` | Discovers available workspace resources |

---

## Agent Framework Capabilities

> **⚠️ IMPORTANT:** When adding any tool to the agent, you MUST also grant permissions in `databricks.yml`. See the **add-tools** skill for required steps and examples.

**Key difference from other templates**: This template offloads the agent loop to Databricks via the Supervisor API. You do not need to implement tool execution logic in Python — just declare hosted tools and Databricks handles the rest.

**Common Patterns:**
- **Structured data retrieval** - Use `genie` tool type to query SQL tables/databases
- **Code interpreter** - Use `uc_function` with `system.ai.python_exec` for Python execution
- **Sub-agent delegation** - Use `agent_endpoint` to call specialized agents
- **External services** - Use `mcp` with a UC connection for external MCP servers

Reference: https://docs.databricks.com/aws/en/generative-ai/agent-bricks/supervisor-api.html
