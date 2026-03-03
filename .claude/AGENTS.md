# Agent Templates — Rules for Modification

These rules apply ONLY when modifying agent templates in this repository. An "agent template" is any top-level directory with the `agent-` prefix, excluding TypeScript/JavaScript templates (e.g., `agent-langchain-ts`).

## CRITICAL: Sync After Modifying Shared Sources

Shared files are copied from source-of-truth directories into each template. **Never manually edit synced copies** — edit the source and run the sync command.

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

- Use `value_from:` (snake_case), never `valueFrom:`
- `bundle.name` uses underscores: `agent_langgraph`
- App `name` uses hyphens: `agent-langgraph`
- Memory template app names are abbreviated (`-stm`, `-ltm`) to stay within the 30-char limit
- App command: `["uv", "run", "start-app"]`
- Experiment name pattern: `/Users/${workspace.current_user.userName}/${bundle.name}-${bundle.target}`
- Lakebase resources use `permission: 'CAN_CONNECT_AND_CREATE'`

### Per-template AGENTS.md

Each template has its own `{template}/AGENTS.md` (loaded via `{template}/CLAUDE.md`). These are maintained individually and are **not synced** — they contain template-specific guidance for end users.

## E2E Tests

Tests live in `.scripts/agent-e2e/`. Run from that directory:

```bash
# All templates in parallel (local + deploy)
uv run pytest test_e2e.py -v -n 7

# Local only (fast, ~2 min/template)
uv run pytest test_e2e.py -v -n 7 --skip-deploy

# Single template, sequential, live output
uv run pytest test_e2e.py -v -n0 -s --skip-deploy --template agent-langgraph
```

Template test configs are in `.scripts/agent-e2e/template_config.py`.

## Editing Workflow Summary

1. **Changing a shared script** (`quickstart.py`, `start_app.py`, `evaluate_agent.py`) — edit in `.scripts/source/`, run `uv run python .scripts/sync-scripts.py`
2. **Changing a skill** — edit in `.claude/skills/`, run `uv run python .scripts/sync-skills.py`
3. **Changing template-specific agent code** — edit directly in `{template}/agent_server/`
4. **Adding a new template** — add to `.scripts/templates.py`, create directory, run both sync commands
5. **Changing `databricks.yml`** — edit directly in the template (not synced)
6. **After any change** — run e2e tests: `cd .scripts/agent-e2e && uv run pytest test_e2e.py -v -n 7 --skip-deploy`
7. **After any change** — review this file (`.claude/AGENTS.md`) and each affected template's `AGENTS.md` for inaccuracies, then update them to reflect the new state
