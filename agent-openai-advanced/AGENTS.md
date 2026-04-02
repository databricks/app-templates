# Agent Development Guide

## MANDATORY First Actions

**Ask the user interactively:**

1. **App deployment target:**
   > "Do you have an existing Databricks app you want to deploy to, or should we create a new one? If existing, what's the app name?"

   *Note: New apps should use the `agent-*` prefix (e.g., `agent-data-analyst`) unless the user specifies otherwise.*

2. **Lakebase instance (required for memory and long-running persistence) — use `AskUserQuestion` tool:**

   **Step A:** Use the `AskUserQuestion` tool to ask the user which type of Lakebase instance they are using:
   - Option 1: **Provisioned** — "I have a provisioned Lakebase instance"
   - Option 2: **Autoscaling** — "I have an autoscaling Lakebase project/branch"

   **Step B (if Provisioned):** Use `AskUserQuestion` to ask:
   > "What is your Lakebase instance name?"

   Then pass it to quickstart: `uv run quickstart --lakebase-provisioned-name <instance-name>`
   For post-deploy setup, see the **lakebase-setup** skill.

   **Step B (if Autoscaling):** Use `AskUserQuestion` to ask:
   > "What is your Lakebase project and branch? You can provide them separately (project name and branch name) or paste the full resource path (e.g. `project/my-project/branch/my-branch`)."

   - If the user provides a resource path like `project/<project>/branch/<branch>`, parse out the project and branch components
   - The user may also paste just a branch resource path like `project/<project-id>/branch/<branch-id>` — parse project and branch from the path segments

   Then pass to quickstart: `uv run quickstart --lakebase-autoscaling-project <project> --lakebase-autoscaling-branch <branch>`
   For post-deploy setup (postgres resource config, granting permissions), see `.claude/skills/add-tools/examples/lakebase-autoscaling.yaml`.

**Autoscaling keywords**: If the user mentions "autoscaling", "project", "branch", or "postgres" in the context of Lakebase/memory, use the **autoscaling** guide at `.claude/skills/add-tools/examples/lakebase-autoscaling.yaml`.

**Then set up the environment using quickstart:**

1. **Read the quickstart skill** at `.claude/skills/quickstart/SKILL.md` — it contains all available CLI flags (including Lakebase options), what the script configures, and fallback instructions.
2. **Check if `.env` exists.** If it does, the environment is already configured — read it to find `DATABRICKS_CONFIG_PROFILE` and skip to verifying auth. If `.env` does not exist, run quickstart:
   ```bash
   uv run quickstart --profile <profile-name> --lakebase-provisioned-name <instance-name>
   ```
3. Run `databricks auth profiles` to verify the profile is configured and valid.

**CRITICAL: All `databricks` CLI commands must include the profile from `.env`.** Either use `--profile` or set the env var:

```bash
databricks <command> --profile <profile>
# or
DATABRICKS_CONFIG_PROFILE=<profile> databricks <command>
```

> **Why this matters:** Without the profile, the CLI may target the wrong workspace, causing "not found" errors for experiments, apps, or other resources.

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

## Granting Lakebase Permissions

After deploying, grant the app's SP Postgres-level permissions to access Lakebase tables. Get the SP client ID then run the grant script:

```bash
# Get SP client ID
databricks apps get <app-name> --profile <profile> --output json | jq -r '.service_principal_client_id'

# Grant all permissions (reads LAKEBASE_INSTANCE_NAME from .env)
DATABRICKS_CONFIG_PROFILE=<profile> uv run python scripts/grant_lakebase_permissions.py <sp-client-id>
```

This grants permissions on the `agent_server`, `ai_chatbot`, and `drizzle` schemas and their tables.

## Handling Deployment Errors

**If `databricks bundle deploy` fails with "An app with the same name already exists":**

Ask the user: "I see there's an existing app with the same name. Would you like me to bind it to this bundle so we can manage it, or delete it and create a new one?"

- **If they want to bind**: See the **deploy** skill for binding steps
- **If they want to delete**: Run `databricks apps delete <app-name>` then deploy again

## Agent Evaluation

When the user asks about evaluating their agent (quality, metrics, scorers, datasets, or tracing), suggest installing the **MLflow Skills** from https://github.com/mlflow/skills. These provide expert guidance for evaluation workflows using MLflow's native APIs.

**Relevant skills:**
- **agent-evaluation** — end-to-end evaluation: dataset creation, scorer selection, execution, result analysis
- **instrumenting-with-mlflow-tracing** — set up automatic tracing for debugging and observability
- **analyze-mlflow-trace** — examine span data and assessments to identify issues

**Install command:**
```bash
npx skills add mlflow/skills
```

After installation, the skills will be available as slash commands (e.g., `/agent-evaluation`). This template also includes a built-in `evaluate_agent.py` script — run it with `uv run agent-evaluate` after starting the local server.

---

## Available Skills

**Before executing any task, read the relevant skill file in `.claude/skills/`** - they contain tested commands, patterns, and troubleshooting steps.

| Task | Skill | Path |
|------|-------|------|
| Setup, auth, first-time | **quickstart** | `.claude/skills/quickstart/SKILL.md` |
| Find tools/resources | **discover-tools** | `.claude/skills/discover-tools/SKILL.md` |
| Create tool resources | **create-tools** | `.claude/skills/create-tools/SKILL.md` |
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
| Deploy | `databricks bundle deploy --profile <profile> && databricks bundle run agent_openai_advanced --profile <profile>` |
| Grant Lakebase perms | `DATABRICKS_CONFIG_PROFILE=<profile> uv run python scripts/grant_lakebase_permissions.py <sp-client-id>` |
| View logs | `databricks apps logs <app-name> --follow` |
| Run long-running tests | `uv run pytest scripts/test_long_running_agent.py -v` |

---

## Key Files

| File | Purpose |
|------|---------|
| `agent_server/agent.py` | Agent logic, model, instructions, MCP servers, session memory |
| `agent_server/start_server.py` | FastAPI server + MLflow setup |
| `agent_server/utils.py` | Shared utilities (session ID, deduplication, stream processing) |
| `agent_server/evaluate_agent.py` | Agent evaluation with MLflow scorers |
| `databricks.yml` | Bundle config & resource permissions |
| `scripts/quickstart.py` | One-command setup script |
| `scripts/discover_tools.py` | Discovers available workspace resources |
| `scripts/grant_lakebase_permissions.py` | Grants Lakebase Postgres permissions to app SP |
| `scripts/test_long_running_agent.py` | Tests for long-running background mode |

---

## Template Features

This template combines **short-term memory** and **long-running background tasks**:

### Short-Term Memory (Session-based)
- Uses `AsyncDatabricksSession` for automatic conversation history management
- Session ID returned in `custom_outputs` for multi-turn conversations
- Deduplication logic prevents message duplication between session and request

### Long-Running Background Tasks
- Background mode via `background=true` in requests — decouples agent lifetime from HTTP connection
- Stream events persisted to Lakebase PostgreSQL for resumable streaming
- Cursor-based retrieval via `GET /responses/{id}?stream=true&starting_after=<cursor>`
- Three-layer timeout protection (asyncio timeout → deferred cleanup → stale-run detection)
- Falls back to standard mode when DB is not configured

### Request Patterns
1. **Standard**: `POST /responses` — blocks until complete (for queries ≤ 120s)
2. **Background + Poll**: `POST /responses { background: true }` → `GET /responses/{id}`
3. **Background + Stream**: `POST /responses { background: true, stream: true }` with cursor-based resumption

---

## Agent Framework Capabilities

> **⚠️ IMPORTANT:** When adding any tool to the agent, you MUST also grant permissions in `databricks.yml`. See the **add-tools** skill for required steps and examples.

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
