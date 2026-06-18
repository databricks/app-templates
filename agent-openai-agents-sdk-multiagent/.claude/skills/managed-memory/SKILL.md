---
name: managed-memory
description: "Give an agent durable, cross-session long-term memory using Databricks MANAGED memory (the Unity Catalog memory-store REST APIs) as tools — governed by UC with no infra the customer needs to run. This works for either OpenAI Agents SDK or LangGraph templates. Use when: the agent should remember a user's preferences/facts/decisions across conversations; keywords 'long-term memory', 'managed memory', 'memory store', 'agentic memory'. This is separate from the self-hosted Lakebase memory solution with skills in (agent-openai-memory / agent-langgraph-memory)."
---

# Long-Term Memory with Databricks Managed Memory (UC memory-store)

Give your agent **durable, cross-session memory** about each user, exposed as five tools
(`save_memory`, `get_memory`, `list_memories`, `update_memory`, `delete_memory`). The tools are thin
REST calls to the Unity Catalog **memory-store** APIs.

> **Beta.** The Databricks memory-store APIs are in beta — APIs and behavior may change.

> ### This is Databricks *managed* memory — NOT the self-hosted Lakebase memory
> A memory store is a governed **Unity Catalog securable** you read/write purely over REST: **no
> database to provision, no tables to create, no embedding endpoint, and no extra Python dependency**
> (it uses the `databricks-sdk` already in the template). This is **different from** the
> `agent-openai-memory` / `agent-langgraph-memory` skills, which persist to a **Lakebase** instance you
> run yourself. It's **additive to short-term/session memory** (the OpenAI `AsyncDatabricksSession` or the
> LangGraph checkpointer) — keep that. But it **is** the agent's long-term memory, and there should be only
> one: if the template already has a long-term memory system, remove it before adding these tools.

This skill is framework-agnostic and flexible with both the OpenAI Agents SDK and LangGraph; each step notes the small per-SDK difference.

**For a pre-existing agent (not built from a default template) — still on Databricks Apps.** The core (memory-store REST API, the five tools, the scope-as-isolation rule, the grant calls in Steps 1–2) is identical; only the template specifics differ. Map the `agent_server/...` paths to your own modules and reuse the Databricks Apps primitives you already have: the **forwarded OBO user token** for the signed-in user's id (what `resolve_scope()` reads), `config.env` for `DATABRICKS_MEMORY_STORE`, and `databricks apps` to deploy. Two invariants never change: the tools authenticate via `WorkspaceClient()` as the **app service principal you grant on the store**, and you pass the **end user's id** as `scope` — fail closed, never the SP.

## Prerequisites — this is an add-on

This skill **adds long-term memory to an agent that's already set up** — it doesn't scaffold one. If there's **no `.env`** (auth not configured), run the **quickstart** skill first — it sets the Databricks profile + MLflow experiment, and on the advanced templates provisions the Lakebase used for short-term *session* memory (which this skill leaves intact). Then come back here. **Verify the app already has everything it needs to run** first — the **quickstart** skill tells you what each template needs set up.

## Concepts

| Object | What it is |
|---|---|
| **Memory store** | A UC securable `catalog.schema.name` (type `MEMORY_STORE`) — the governance object you grant on and the container for memories. Read/written over REST, no SQL. |
| **Memory entry** | One memory: a `path` (e.g. `/memories/preferences/coffee.md`), a one-line `description`, and optional `contents`. |
| **Scope** | The partition key the caller assigns (e.g. an end-user or project ID) — decides whose memories you read/write. |

**Access is two separate questions:**
- *Can the caller use the store?* → make sure the caller has `READ_MEMORY_STORE` to retrieve memory entries and `WRITE_MEMORY_STORE` to write them. When testing locally the tools are called with the developer's credentials; when the agent is deployed on Apps they run with the app's credentials.
- *Whose memories?* → the explicit **`scope`**, set by your code to the end user's id, project id, etc.

The SP can see every scope, so **`scope` is your isolation boundary**: always set it to the end user, in trusted code, and **never let the model choose it**.

## Step 1 — Create or choose the memory store

Have your admin or agent developer create a memory store you can read/write memory entries to. First establish workspace creds:

```bash
export DATABRICKS_HOST="https://<your-workspace-host>"
export TOKEN="$(databricks auth token -p <profile> | jq -r .access_token)"
```

**Ask the user with `AskUserQuestion`** (multi-choice): *"Do you have an existing memory store you can manage, or should I create one?"*
- **Use an existing store** — you own it, or hold MANAGE / MANAGE_ACCESS_CONTROL on it.
- **Create a new store** — under a catalog + schema you choose; you become the owner (needs `CREATE_MEMORY_STORE` on that schema).

Then collect the details as normal chat messages (free-text — not `AskUserQuestion`) and run the matching API call. Run these yourself so you can see exactly what each does:

```bash
# CREATE a store you own. Returns the securable {full_name, owner, memory_store_id, ...}.
curl -sS -X POST "$DATABRICKS_HOST/api/2.1/unity-catalog/memory-stores" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"<name>","catalog_name":"<catalog>","schema_name":"<schema>","description":"Long-term memory for my agent"}'

# OR CONFIRM an existing store resolves (catches a typo'd name now instead of as NOT_FOUND at runtime):
curl -sS "$DATABRICKS_HOST/api/2.1/unity-catalog/memory-stores/<catalog.schema.name>" -H "Authorization: Bearer $TOKEN"
```

**Record the full name** in the **same** env var, in two places — `.env` (read locally) **and** `databricks.yml` under the app's `config.env` (the deployed app doesn't read `.env`):

```yaml
      config:
        env:
          - name: DATABRICKS_MEMORY_STORE
            value: "<catalog.schema.name>"
```

## Step 2 — Grant read+write on the store (API calls)

The tools call the API **as whatever principal the agent runs as**: the **app service principal** once deployed, and the **developer's own user** when running locally (the agent's `WorkspaceClient()` picks up the local profile). Grant `READ_MEMORY_STORE` + `WRITE_MEMORY_STORE` to **both**. DAB has **no `MEMORY_STORE` grant** yet, so this is a direct permissions API call (not `databricks.yml`) — run the `PATCH`es below yourself. `STORE` is the full name:

```bash
export STORE="<catalog.schema.name>"
PERM="$DATABRICKS_HOST/api/2.1/unity-catalog/permissions/memory_store/$STORE"

# Grant the DEVELOPER's user (for local testing — the local agent runs as them):
curl -sS -X PATCH "$PERM" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"changes":[{"principal":"<developer@org.com>","add":["READ_MEMORY_STORE","WRITE_MEMORY_STORE"]}]}'

# Grant the DEPLOYED app's service principal (run AFTER deploy, once the app + its SP exist):
APP_SP=$(databricks apps get <your-app> -o json | jq -r .service_principal_client_id)
curl -sS -X PATCH "$PERM" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"changes\":[{\"principal\":\"$APP_SP\",\"add\":[\"READ_MEMORY_STORE\",\"WRITE_MEMORY_STORE\"]}]}"

# Verify current grants:
curl -sS "$PERM" -H "Authorization: Bearer $TOKEN"
```

## Step 3 — Add the memory tools

Put these in `agent_server/utils_memory.py` — use **(a) the shared core + the block for your SDK** ((b) for the OpenAI Agents SDK *or* (c) for LangGraph; not both — they each define `_scope` their own way). **No new dependency** — it uses the `databricks-sdk` already in the template. **Most templates have no `utils_memory.py` — create it** (note the OpenAI advanced template keeps its *session* plumbing in `utils.py`, not here, so you still create a fresh `utils_memory.py`). **The one exception is `agent-langgraph-advanced`**: its existing `utils_memory.py` already holds the Lakebase plumbing — short-term checkpointer **and** a long-term `AsyncDatabricksStore` + `memory_tools()`. There, add these functions to that **same file** (don't create a second one), keep the checkpointer, and **replace** the long-term store — only one long-term system (see the intro and Step 4).

**(a) Shared core** — the REST calls and scope resolution (SDK-agnostic):

```python
import os
from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import DatabricksError
from mlflow.genai.agent_server import get_request_headers
from agent_server.utils import get_user_workspace_client

# API: BASE = /api/2.1/unity-catalog/memory-stores/{DATABRICKS_MEMORY_STORE}
#   create  POST {BASE}/entries?scope=…   {path,contents,description,creation_reason,creation_source}  (flat body; scope is a query param)
#   get     GET  {BASE}/entries:get       ?scope,path        -> {contents, description, ...}
#   list    GET  {BASE}/entries           ?scope             -> {entries:[{path,description,has_contents}]}  (key omitted entirely when empty)
#   update  PATCH{BASE}/entries          {scope, path, [description], [one contents edit op]}  (>=1 of the two)
#   delete  DELETE {BASE}/entries         ?scope,path

_client: WorkspaceClient | None = None

def _ws() -> WorkspaceClient:
    """The memory caller — the app SP when deployed, the developer when local. Per-user isolation is via
    `scope`, NEVER this identity (the SP can see every scope)."""
    global _client
    if _client is None:
        _client = WorkspaceClient()
    return _client

def _entries(suffix: str = "") -> str:
    store = os.getenv("DATABRICKS_MEMORY_STORE")
    if not store:
        raise RuntimeError("DATABRICKS_MEMORY_STORE is not set — it must be the full catalog.schema.name.")
    return f"/api/2.1/unity-catalog/memory-stores/{store}/entries{suffix}"

def resolve_scope(request=None) -> str | None:
    """The end user's id used as `scope`, or None if it can't be determined (the handler MUST fail
    closed). Deployed: the OBO forwarded token -> current_user.me().id — the ONLY trusted source.
    Local: an X-Forwarded-User header, the request's custom_inputs.user_id (what the bundled chat UI /
    preflight send), or a dev-only DATABRICKS_MEMORY_SCOPE env var. NEVER the app's own identity, and
    NEVER a client-supplied value (X-Forwarded-User / custom_inputs) when deployed — those are spoofable."""
    headers = get_request_headers() or {}
    if headers.get("x-forwarded-access-token"):
        return get_user_workspace_client().current_user.me().id
    # Deployed -> the verified OBO token above is the only trusted source. DATABRICKS_APP_NAME is set by
    # the Apps runtime when deployed, so the client-supplied fallbacks below are LOCAL-DEV ONLY:
    if os.getenv("DATABRICKS_APP_NAME"):
        return None
    ci = dict(getattr(request, "custom_inputs", None) or {})
    return headers.get("x-forwarded-user") or ci.get("user_id") or os.getenv("DATABRICKS_MEMORY_SCOPE")

# The five operations. `scope` is passed in (never model-supplied). Each returns a short string.
def _save(scope, path, description, contents=""):
    try:
        _ws().api_client.do("POST", _entries(), query={"scope": scope}, body={
            "path": path, "contents": contents, "description": description,
            "creation_reason": "CREATION_REASON_AGENT_INFERRED",
            "creation_source": "CREATION_SOURCE_ONLINE_AGENT"})
    except DatabricksError as e:
        if e.error_code == "ALREADY_EXISTS":
            return f"A memory already exists at {path}; use update_memory to revise it."
        return f"Could not save {path}: {getattr(e, 'message', str(e))}"
    return f"Saved memory at {path}."

def _get(scope, path):
    try:
        entry = _ws().api_client.do("GET", _entries(":get"), query={"scope": scope, "path": path})
    except DatabricksError as e:
        if e.error_code == "NOT_FOUND":
            return f"No memory at {path}."
        return f"Could not read {path}: {getattr(e, 'message', str(e))}"
    # A brief memory may have empty contents — its description is then the memory.
    return entry.get("contents") or entry.get("description") or f"(empty memory at {path})"

def _list(scope):
    try:
        resp = _ws().api_client.do("GET", _entries(), query={"scope": scope})
    except DatabricksError as e:
        return f"Could not list memories: {getattr(e, 'message', str(e))}"
    items = resp.get("entries", [])
    if not items:
        return "No memories yet."
    # Count header (the model is unreliable at tallying a long list); `[has_contents]` marks entries
    # whose body must be read with get_memory — unmarked entries are captured by their description.
    lines = [
        ("[has_contents] " if e.get("has_contents") else "") + f"- {e['path']}: {e.get('description', '')}"
        for e in items
    ]
    return f"{len(items)} memories total:\n" + "\n".join(lines)

def _update(scope, path, op=None, description=None):  # op = at most one of str_replace/insert/replace_all
    op = op or {}
    if len(op) > 1:
        return "Pass at most one contents edit (str_replace / insert / replace_all)."
    if not op and description is None:
        return "Provide a new description and/or one contents edit (str_replace / insert / replace_all)."
    body = {"scope": scope, "path": path, **op}
    if description is not None:
        body["description"] = description
    try:
        _ws().api_client.do("PATCH", _entries(), body=body)
    except DatabricksError as e:
        if e.error_code == "NOT_FOUND":
            return f"No memory at {path} to update — check list_memories or save it first."
        # e.g. str_replace.old_str matched 0 or >1 times -> return it so the model re-reads and retries.
        return f"Could not update {path}: {getattr(e, 'message', str(e))}"
    return f"Updated {path}."

def _delete(scope, path):
    try:
        _ws().api_client.do("DELETE", _entries(), query={"scope": scope, "path": path})
    except DatabricksError as e:
        if e.error_code == "NOT_FOUND":
            return f"No memory at {path} (already gone)."
        return f"Could not delete {path}: {getattr(e, 'message', str(e))}"
    return f"Deleted {path}."
```

> `resolve_scope()` uses two helpers the app-templates ship — `get_request_headers()` (MLflow `agent_server`)
> and `get_user_workspace_client()` (the template's `utils`). If your Databricks App doesn't have them, do the
> same thing directly: read the forwarded user token (`X-Forwarded-Access-Token`) from the request and call
> `current_user.me().id` on a `WorkspaceClient` built with it — return that id, or `None` to fail closed.

**(b) OpenAI Agents SDK wrappers** — thin decorators over the shared core; `scope` comes from the run context:

```python
from dataclasses import dataclass
from agents import RunContextWrapper, function_tool

@dataclass
class MemoryContext:
    """Per-request run context. `scope` partitions memories by end user; set by the app, never the model."""
    scope: str

def _scope(ctx: RunContextWrapper[MemoryContext]) -> str:
    if not ctx.context.scope:
        raise RuntimeError("No end-user scope for this request — refusing a shared memory bucket.")
    return ctx.context.scope

# strict_mode=False: lets `contents` be genuinely optional / allows free-form dict edit ops.
@function_tool(strict_mode=False)
async def save_memory(ctx: RunContextWrapper[MemoryContext], path: str, description: str, contents: str = "") -> str:
    """Create ONE durable memory — a stable preference, fact, decision, or ongoing project; not one-off
    chatter or secrets. Create-only (an existing path errors), so check list_memories first and use
    update_memory to revise a topic. path: a SHORT, STABLE topic bucket (lowercase-hyphenated, starts
    /memories/, ends .md) — keep it broad and reusable (e.g. /memories/preferences/food.md); put the
    specifics in description/contents, NOT the path, so related facts share one path and you update it
    instead of minting near-duplicates (avoid over-specific paths like /memories/preferences/coffee-oat-milk.md).
    description: a one-line statement; for a brief fact this IS the memory (leave contents empty).
    contents: OPTIONAL — only when the memory needs more than one line; detailed; never echo the description."""
    return _save(_scope(ctx), path, description, contents)

@function_tool
async def get_memory(ctx: RunContextWrapper[MemoryContext], path: str) -> str:
    """Read the FULL contents of ONE memory by its exact path (from list_memories). The only way to see
    what a memory says — always get_memory before stating a remembered fact; a description is just a
    label. Not found means it isn't stored, not that the fact is false."""
    return _get(_scope(ctx), path)

@function_tool
async def list_memories(ctx: RunContextWrapper[MemoryContext]) -> str:
    """List EVERY saved memory as (path, description) — the index; returns NO contents. Your first step
    for recall (scan → pick the relevant path(s)) and before saving (so you update an existing topic rather
    than duplicate). An entry prefixed `[has_contents]` has a fuller body — get_memory(path) to read it
    before stating specifics; an entry without that prefix is fully captured by its description. One call per turn."""
    return _list(_scope(ctx))

@function_tool(strict_mode=False)
async def update_memory(ctx: RunContextWrapper[MemoryContext], path: str, description: str | None = None,
                        str_replace: dict | None = None, insert: dict | None = None,
                        replace_all: dict | None = None) -> str:
    """Revise an EXISTING memory in place (same path; the path can't change). Pass description="..." to
    replace its one-line description (use this to correct a brief, description-only memory), and/or EXACTLY
    ONE contents edit op — str_replace={"old_str": ..., "new_str": ...} (old_str must occur once) ·
    insert={"insert_text": ..., "insert_line": <optional>} · replace_all={"contents": ...}. get_memory first
    so a contents edit matches; at least one of description / an edit op is required."""
    op = {k: v for k, v in (("str_replace", str_replace), ("insert", insert), ("replace_all", replace_all)) if v}
    return _update(_scope(ctx), path, op, description)

@function_tool
async def delete_memory(ctx: RunContextWrapper[MemoryContext], path: str) -> str:
    """Permanently remove ONE memory by its exact path. Use for stale/wrong/superseded/duplicate entries
    or when the user asks to forget something. Don't delete to rewrite a valid fact — use update_memory."""
    return _delete(_scope(ctx), path)

MEMORY_TOOLS = [save_memory, get_memory, list_memories, update_memory, delete_memory]
```

**(c) LangGraph version** — the *same five tools and docstrings*, with three differences: decorate with
`@tool`, take `config: RunnableConfig` instead of `ctx`, and read scope from the config. Wrap them in a
`memory_tools()` factory. One tool shown; apply the identical change to the other four:

```python
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

def _scope(config: RunnableConfig) -> str:
    s = (config.get("configurable") or {}).get("memory_scope")
    if not s:
        raise RuntimeError("No end-user scope in config — refusing a shared memory bucket.")
    return s

def memory_tools():
    @tool
    async def save_memory(path: str, config: RunnableConfig, description: str, contents: str = "") -> str:
        """<same docstring as the OpenAI save_memory above>"""
        return _save(_scope(config), path, description, contents)
    # get_memory / list_memories / update_memory / delete_memory: identical bodies, calling
    # _get/_list/_update/_delete(_scope(config), ...). `config` is injected by LangChain and hidden
    # from the model.
    return [save_memory, get_memory, list_memories, update_memory, delete_memory]
```

> **Search:** recall is intentionally `list_memories → get_memory` (V1 search is an unreliable O(N) keyword
> scan). If you want it later, add a tool over `POST {BASE}/entries:search {scope, query, top_k}`.

## Step 4 — Register the tools and wire scope (fail closed, additive)

These are **additions** to the agent/handlers you already have — don't rewrite them or drop existing args.

**Resolve scope once per request and fail closed** — never an empty scope or the app identity:

```python
from fastapi import HTTPException
scope = resolve_scope(request)   # pass the request so it can read custom_inputs.user_id locally
if not scope:
    raise HTTPException(status_code=401, detail="No end-user identity — refusing a shared memory scope.")
    # MLflow's agent_server surfaces this as a 500; either way the request is refused.
```

**OpenAI Agents SDK** — add the tools to your existing `Agent`, and add `context=` to the `Runner.run` call you already have:
```python
from agent_server.utils_memory import MEMORY_TOOLS, MemoryContext, resolve_scope
# Agent(... tools=[*<your existing tools>, *MEMORY_TOOLS], instructions=MEMORY_INSTRUCTIONS)
result = await Runner.run(agent, messages, context=MemoryContext(scope=scope))
# If your handler already passes session= (any short-term session memory), KEEP it:
result = await Runner.run(agent, messages, session=session, context=MemoryContext(scope=scope))
```

> **Multi-agent (supervisor + sub-agents):** put `MEMORY_TOOLS` on the **orchestrator** `Agent` and pass `MemoryContext(scope=...)` to its `Runner.run`. Scope automatically reaches sub-agents that run **in-process** (`Agent.as_tool()` / handoffs in the same run) — they share the run context, so they *can* also carry the tools. Sub-agents that are **separate deployed endpoints** run in their own process with no shared context: each needs its own memory wiring and its own scope source (its forwarded OBO token). Don't try to thread `scope` across a service boundary.

**LangGraph** — add the tools to `create_agent`, and put scope in the graph config under `memory_scope`:
```python
from agent_server.utils_memory import memory_tools, resolve_scope
# create_agent(tools=[*<your existing tools>, *memory_tools()], system_prompt=MEMORY_INSTRUCTIONS, ...)
config = {"configurable": {"memory_scope": scope}}          # add to the config you already pass
agent.astream(input=messages, config=config, stream_mode=["updates", "messages"])
```

> If the template already wires its own long-term memory (e.g. a LangGraph `store=` / `AsyncDatabricksStore`
> with its own memory tools), remove it here — keep the checkpointer. (Replace, don't stack — see the intro.)
> Heads-up: it may be **entangled with short-term memory** — co-provisioned in a shared resource manager
> (one context that yields *both* checkpointer and store) and/or set up in the server lifespan. So removing
> it can be more than deleting one argument: excise only the long-term store and its setup, and leave the
> short-term path intact. Inspect the wiring rather than assuming a one-liner.

`resolve_scope(request)`: deployed → the **verified** OBO token → `current_user.me().id` (the only source trusted in prod — it can't be spoofed and **supersedes** any client-supplied `custom_inputs.user_id` the template uses for its own memory). Local → an `X-Forwarded-User` header, the request's `custom_inputs.user_id` (what the bundled **chat UI** and **`preflight`** send), or `DATABRICKS_MEMORY_SCOPE`. If preflight / the chat UI fail closed (401/500) locally, you're missing a local identity — pass `custom_inputs.user_id` or set `DATABRICKS_MEMORY_SCOPE`.

## Step 5 — Agent instructions

Define `MEMORY_INSTRUCTIONS` near the top of `agent_server/agent.py` and pass it as the agent's
`instructions` (OpenAI) / `system_prompt` (LangGraph). If the agent already has a prompt, **prepend yours and keep it** — but if you just **replaced** a prior memory system (Step 3/4), first delete any text in that prompt that names the old tools you removed (e.g. an `agent-langgraph-advanced` prompt that referenced `get_user_memory` / `save_user_memory`), or the model will be told to call tools that no longer exist:

```python
MEMORY_INSTRUCTIONS = """You have durable, cross-session memory about whoever (or whatever) this conversation is scoped to. Use it deliberately, not by reflex.

Recall whenever the answer is about the user or calls for personalized information — anything that might draw on preferences, decisions, or workflows they've shared before — and you don't already have it from this conversation; also list once before saving, to find the right existing topic. Don't tell the user you don't know their preferences without checking — list_memories first. Skip memory only when the answer truly doesn't depend on who's asking (general knowledge, math, coding) or you already have what you need. A `[has_contents]` entry has a body to get_memory; one without is fully captured by its description. Open a memory with get_memory before you state its specifics, and never assert a fact that isn't stored — if nothing relevant is stored, just answer without it. Don't re-list what you've already seen this turn.

Save only what will still matter in a future, unrelated conversation — a stable preference, fact, decision, or ongoing project the user actually stated or decided. Don't save your own suggestions or guesses, passing chatter, secrets, or anything scoped to this chat ("for now", a one-off label).
- Write each memory so it stands on its own out of context, under one broad, stable /memories/... topic per subject with the specifics inside it.
- Check the list first and update_memory an existing topic instead of minting a near-duplicate.
- For a very broad question that touches many memories, summarize from the list's descriptions; reserve get_memory for the specific entry you actually need.
- If the user's info changes or contradicts what's stored, update or replace it rather than keeping both — but don't rewrite a memory that already says the same thing.
- delete_memory what's stale.
- Briefly tell the user whenever you save, update, or delete."""
```

## Test

Run the server for API-only testing with `uv run start-app --no-ui --port 8000` — plain `start-app` also clones and builds the Next.js chat UI (slow, and unneeded for curl); `--no-ui` skips it and `--port` sets the port (match it in the curls below).

```bash
# Local: no forwarded headers exist, so fake a user with X-Forwarded-User (any string; grant your user first, Step 2).
curl localhost:8000/invocations -H 'Content-Type: application/json' -H 'X-Forwarded-User: alice' \
  -d '{"input":[{"role":"user","content":"Remember I am allergic to peanuts."}]}'
# Same id later -> recalls; a different X-Forwarded-User sees nothing (isolation).

# Deployed: scope comes from the real OBO token automatically (no X-Forwarded-User). Use an OAuth token —
# PATs don't work for Apps. Grant the app SP first (Step 2).
TOKEN=$(databricks auth token --host <workspace-url> | jq -r .access_token)
curl -X POST https://<app-url>/invocations -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"input":[{"role":"user","content":"What do you remember about me?"}]}'
```

## Limits & errors (beta)

- **Path:** starts `/memories/`, ≤1024 chars, no whitespace/control chars/empty segments/trailing `/`. Re-creating a path → `ALREADY_EXISTS` (use `update_memory`).
- **Update:** pass `description` to replace the one-line description, and/or one contents edit op. `str_replace.old_str` must match exactly once or `INVALID_PARAMETER_VALUE` — `get_memory` to re-read and retry with more surrounding text.
- **List volume:** ≤ ~5000 entries per `(store, scope)`, no "more" signal yet.
- **Retryable:** `ABORTED` (concurrent write) and transient `5xx`/`DEADLINE_EXCEEDED` are safe to retry; `INVALID_PARAMETER_VALUE`/`NOT_FOUND`/`ALREADY_EXISTS` aren't.

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| `RuntimeError: DATABRICKS_MEMORY_STORE is not set` | env var missing | Set it in `.env` (local) **and** `databricks.yml` `config.env` (deploy) — Step 1 |
| `500` + "No end-user identity" | scope didn't resolve (fail-closed guard fired; framework surfaces 401 as 500). Common locally: the bundled **chat UI / `preflight`** send `custom_inputs.user_id` but no forwarded header | Deployed: ensure the OBO user token reaches the app. Local: pass `custom_inputs.user_id`, send `X-Forwarded-User`, or set `DATABRICKS_MEMORY_SCOPE` |
| `PERMISSION_DENIED` | caller lacks `READ/WRITE_MEMORY_STORE` | Grant the app SP / your user — Step 2 |
| `NOT_FOUND` on **every** call | wrong store name / store doesn't exist | Re-check `DATABRICKS_MEMORY_STORE` is the full `catalog.schema.name` (confirm with the Step 1 `GET`) |
| `ALREADY_EXISTS` on save | path is taken | `update_memory`, or pick a fresh path |
| Tools still hit a vector store (LangGraph advanced) | old `AsyncDatabricksStore` `memory_tools()` not removed | Drop `store=` and the old factory; keep the checkpointer |

## Notes

- **Scope is the isolation boundary** — set it in trusted code (Step 4), never let the model pass it. The app SP can read every scope.
- **No memory structure yet:** entries are flat per scope; the agent invents `/memories/...` paths.
- **Description vs contents:** for a brief fact the `description` is the whole memory (leave `contents` empty); `update_memory` can revise the `description` and/or the `contents`.
- **Combining with short-term memory:** additive — keep the template's session memory (OpenAI `session=`, LangGraph checkpointer). On the advanced templates, after deploy also grant the app SP its Lakebase Postgres privileges (the template's own requirement) or it 502s on session setup.

## Next Steps

- Run locally: see the **run-locally** skill. Deploy: see the **deploy** skill (then grant the deployed SP, Step 2).
