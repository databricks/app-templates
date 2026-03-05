# Agent Templates — Rules for Modification

These rules apply ONLY when modifying agent templates in this repository. An "agent template" is any top-level directory with the `agent-` prefix, excluding TypeScript/JavaScript templates (e.g., `agent-langchain-ts`).

## CRITICAL: Sync After Modifying Shared Sources

Shared files are copied from source-of-truth directories into each template. **Never manually edit synced copies** (e.g. `{template}/quickstart.py`, `{template}/start_app.py`, `{template}/evaluate_agent.py`) — always edit the source file in `.scripts/source/` or `.claude/skills/` first, then run the sync command to propagate changes to all templates.

| Source directory | Sync command | What it syncs |
|---|---|---|
| `.scripts/source/` | `uv run python .scripts/sync-scripts.py` | `quickstart.py`, `start_app.py`, `evaluate_agent.py` |
| `.claude/skills/` | `uv run python .scripts/sync-skills.py` | All skill directories under `{template}/.claude/skills/` |

After modifying any source file, run the corresponding sync command and commit the synced copies.

## Template Registry

`.scripts/templates.py` is the canonical registry — see `TEMPLATES` dict for the full list of templates, their SDKs, and bundle names. All sync scripts and e2e tests import from it.

To add a new template: add its entry to `TEMPLATES` in `.scripts/templates.py`, create the directory, then run both sync commands.

## Template Conventions

### Handler naming

All handlers live in `agent_server/agent.py`. Use `@invoke()` and `@stream()` decorators from `mlflow.genai.agent_server`:

```python
@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse: ...

@stream()
async def stream_handler(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]: ...
```

LangGraph `invoke_handler` delegates to `stream_handler`. OpenAI SDK `invoke_handler` calls `Runner.run()` independently.

### MLflow autologging

- LangGraph templates: `mlflow.langchain.autolog()`
- OpenAI SDK templates: `mlflow.openai.autolog()` + `set_trace_processors([])`

All handlers tag traces with: `mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})`

### MCP server initialization

- **LangGraph**: `DatabricksMultiServerMCPClient` wrapping `DatabricksMCPServer` objects. Tools fetched once at agent init via `.get_tools()`.
- **OpenAI SDK**: `McpServer` used as async context manager per-request: `async with await init_mcp_server() as mcp_server:`

### Session/memory patterns

| Pattern | SDK | Class | ID field |
|---|---|---|---|
| Short-term memory | LangGraph | `AsyncCheckpointSaver` | `thread_id` via `config["configurable"]` |
| Long-term memory | LangGraph | `AsyncDatabricksStore` | `user_id` via `config["configurable"]` |
| Short-term memory | OpenAI | `AsyncDatabricksSession` | `session_id` passed to `Runner.run(..., session=)` |

All memory templates return the ID in `custom_outputs` so clients can reuse it.

### `databricks.yml` conventions

- `bundle.name` uses underscores: `agent_langgraph`
- App `name` uses hyphens: `agent-langgraph`
- Memory template app names are abbreviated (`-stm`, `-ltm`) to stay within the 30-char limit
- App command: `["uv", "run", "start-app"]`
- Lakebase resources use `permission: 'CAN_CONNECT_AND_CREATE'`
- Lakebase templates use `<your-lakebase-instance-name>` as placeholder — quickstart replaces it
- Templates do not define a DAB-managed experiment resource (`resources.experiments`); instead, the app resource references an experiment by ID (initially empty), and quickstart fills in the literal experiment ID

### `app.yaml` files

The 3 base templates (`agent-langgraph`, `agent-openai-agents-sdk`, `agent-non-conversational`) have `app.yaml` files for UI-based template creation in the Databricks UI. These are separate from `databricks.yml` and use `valueFrom` (camelCase) for resource references. Memory/multiagent variants do not need separate `app.yaml` files.

### Per-template AGENTS.md

Each template has its own `{template}/AGENTS.md` (loaded via `{template}/CLAUDE.md`). These are maintained individually and are **not synced** — they contain template-specific guidance for end users.

## Tests

### Quickstart unit tests

The quickstart unit tests (`test_quickstart.py`) live in `.scripts/source/` but have no `pyproject.toml` of their own. Run them from `.scripts/agent-integration-tests/` which has pytest installed:

```bash
cd .scripts/agent-integration-tests && uv run pytest ../source/test_quickstart.py -v
```

### E2E integration tests

Tests live in `.scripts/agent-integration-tests/`. Run from that directory.

**Default runs both local and deploy.** Only add `--skip-deploy` or `--skip-local` when the user explicitly asks.

```bash
# DEFAULT: All templates in parallel (local + deploy)
uv run pytest test_e2e.py -v -n 7

# Single template (still runs both local + deploy)
uv run pytest test_e2e.py -v --template agent-langgraph

# Sequential with live output (for debugging)
uv run pytest test_e2e.py -v -n0 -s --template agent-langgraph
```

Template test configs are in `.scripts/agent-integration-tests/template_config.py`.

## Editing Workflow Summary

1. **Changing a shared script** (`quickstart.py`, `start_app.py`, `evaluate_agent.py`) — edit in `.scripts/source/`, run `uv run python .scripts/sync-scripts.py`
2. **Changing a skill** — edit in `.claude/skills/`, run `uv run python .scripts/sync-skills.py`
3. **Changing template-specific agent code** — edit directly in `{template}/agent_server/`
4. **Adding a new template** — add to `.scripts/templates.py`, create directory, run both sync commands
5. **Changing `databricks.yml`** — edit directly in the template (not synced)
6. **After any change** — run e2e tests: `cd .scripts/agent-integration-tests && uv run pytest test_e2e.py -v -n 7 --skip-deploy`
7. **After any change** — review this file (`.claude/AGENTS.md`) and each affected template's `AGENTS.md` for inaccuracies, then update them to reflect the new state
