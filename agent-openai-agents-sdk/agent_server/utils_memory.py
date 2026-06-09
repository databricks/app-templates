"""Long-term memory tools backed by the Databricks managed-memory (UC memory-store) APIs.

Drop this file into `agent_server/` and register MEMORY_TOOLS with your Agent (see SKILL.md).
Each tool is a thin REST call to the memory-entry API, made as the app service principal
(or as you, when running locally). The per-user `scope` is injected via the run context
(MemoryContext) — never a model-visible argument — so the model cannot read or write another
user's memories.

API (Databricks managed memory, beta):
    create:  POST   {BASE}/entries                 body {scope, memory_entry:{path,contents,description}}
    get:     GET    {BASE}/entries:get             query {scope, path}        -> {contents, ...}
    list:    GET    {BASE}/entries                  query {scope}              -> {entries:[{path,description}]}
    search:  POST   {BASE}/entries:search           body {scope, query, top_k} -> {results:[{memory_entry}]}
    update:  PATCH  {BASE}/entries                  body {scope, path, <one edit op>}
    delete:  DELETE {BASE}/entries                  query {scope, path}
  where BASE = /api/2.1/unity-catalog/memory-stores/{DATABRICKS_MEMORY_STORE}

Setup (one-time, outside this file — see SKILL.md):
  - Create/choose a MEMORY_STORE securable; set DATABRICKS_MEMORY_STORE to its full name
    (e.g. "main.default.agent_memory").
  - Grant the caller (the app SP when deployed, you when local) READ_MEMORY_STORE + WRITE_MEMORY_STORE.
"""

import os
from dataclasses import dataclass

from agents import RunContextWrapper, function_tool
from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import DatabricksError
from mlflow.genai.agent_server import get_request_headers

from agent_server.utils import get_user_workspace_client

_client: WorkspaceClient | None = None


def _ws() -> WorkspaceClient:
    """The memory caller — the app service principal when deployed, you when local. Reused by every
    call. Per-user isolation is via `scope`, NEVER this identity (the SP can see every scope)."""
    global _client
    if _client is None:
        _client = WorkspaceClient()
    return _client


def _entries(suffix: str = "") -> str:
    store = os.getenv("DATABRICKS_MEMORY_STORE")
    if not store:
        raise RuntimeError(
            "DATABRICKS_MEMORY_STORE is not set — it must be the MEMORY_STORE full name, "
            "e.g. 'main.default.agent_memory'."
        )
    return f"/api/2.1/unity-catalog/memory-stores/{store}/entries{suffix}"


def _hdrs() -> dict | None:
    # DEV/BETA ONLY: route memory-store calls through a LiteSwap while the API is pre-GA. Set
    # DATABRICKS_MEMORY_TRAFFIC_ID to the swap id; unset = no header (GA behavior). Remove at GA.
    tid = os.getenv("DATABRICKS_MEMORY_TRAFFIC_ID")
    return {"x-databricks-traffic-id": tid} if tid else None


def _do(method: str, path: str, **kwargs):
    """All memory-store REST calls go through here so the (beta-only) LiteSwap header is attached."""
    return _ws().api_client.do(method, path, headers=_hdrs(), **kwargs)


@dataclass
class MemoryContext:
    """Per-request run context. `scope` partitions memories by end user; set by the app's
    resolve_scope() in trusted code, NEVER by the model."""

    scope: str


def resolve_scope() -> str | None:
    """Resolve the end user's id used as the memory `scope`, or None if it can't be determined.

    Deployed: the on-behalf-of forwarded token -> that user's id (the proven path every shipped
    template uses). Local: an explicit `X-Forwarded-User` header (fake any id for multi-user
    testing), or a dev-only DATABRICKS_MEMORY_SCOPE env var so the bundled chat UI works locally.

    Returns None if no end-user identity is available — the caller MUST fail closed (see the wiring
    in SKILL.md). Never fall back to the app's own identity: that would merge every user into one bucket.
    """
    headers = get_request_headers() or {}
    if headers.get("x-forwarded-access-token"):
        return get_user_workspace_client().current_user.me().id
    # Deployed apps must carry the OBO token above. DATABRICKS_APP_NAME is set by the Apps runtime
    # when deployed, so the header/env fallbacks below are LOCAL-DEV ONLY — deployed we fail closed
    # rather than trust a client-settable header for the scope.
    if os.getenv("DATABRICKS_APP_NAME"):
        return None
    return headers.get("x-forwarded-user") or os.getenv("DATABRICKS_MEMORY_SCOPE")


def _scope(ctx: RunContextWrapper[MemoryContext]) -> str:
    if not ctx.context.scope:
        raise RuntimeError("No end-user scope for this request — refusing to use a shared memory bucket.")
    return ctx.context.scope


# --- tools -----------------------------------------------------------------------------------------


@function_tool(strict_mode=False)
async def save_memory(
    ctx: RunContextWrapper[MemoryContext], path: str, description: str, contents: str = ""
) -> str:
    """Create ONE durable memory about the user — a stable preference, fact, decision, or ongoing
    project; not one-off chatter or secrets. Create-only: an existing path errors, so check
    list_memories first and use update_memory to revise an existing topic.
    - path: you choose it — starts /memories/, topic-grouped, lowercase-hyphenated, ends .md
      (e.g. /memories/preferences/coffee.md). One topic per path; reuse existing folders.
    - description: a one-line statement of the memory (e.g. "Allergic to peanuts"). For a brief fact
      this IS the memory — put it here and leave contents empty.
    - contents: OPTIONAL — add only when the memory needs more than one line (detail, nuance,
      specifics), self-contained so it reads correctly cold later; omit for brief facts, never echo description."""
    try:
        _do(
            "POST",
            _entries(),
            body={
                "scope": _scope(ctx),
                "memory_entry": {
                    "path": path,
                    "contents": contents,
                    "description": description,
                    # Mark agent-written memories so they're distinguishable from user-written ones.
                    "creation_reason": "CREATION_REASON_AGENT_INFERRED",
                    "creation_source": "CREATION_SOURCE_ONLINE_AGENT",
                },
            },
        )
    except DatabricksError as e:
        if e.error_code == "ALREADY_EXISTS":
            return f"A memory already exists at {path}; use update_memory to revise it."
        raise
    return f"Saved memory at {path}."


@function_tool
async def get_memory(ctx: RunContextWrapper[MemoryContext], path: str) -> str:
    """Read the FULL contents of ONE memory by its exact path (from list_memories). The only way to
    see what a memory says — always get_memory before stating a remembered fact; a description is
    just a label. path: the exact /memories/... string, matched exactly (a direct key lookup by
    path, not a scan) — don't guess paths. Returns the full contents; if not found, re-check
    list_memories (not-found means it isn't stored, not that the fact is false)."""
    try:
        entry = _do("GET", _entries(":get"), query={"scope": _scope(ctx), "path": path})
    except DatabricksError as e:
        if e.error_code == "NOT_FOUND":
            return f"No memory at {path}."
        raise
    # A brief memory may have empty contents — its description (from list_memories) is the memory.
    return entry.get("contents") or entry.get("description") or f"(empty memory at {path})"


@function_tool
async def list_memories(ctx: RunContextWrapper[MemoryContext]) -> str:
    """List EVERY saved memory as (path, description) — the index; returns NO contents. Your first
    step for recall (scan descriptions → pick path(s) → get_memory each) and before saving (check the
    topic isn't already stored). A brief memory's description IS the memory; for detailed ones the
    description is a label, so get_memory(path) to read the body. No args; one call per turn, reuse
    within the conversation. Empty if nothing saved."""
    resp = _do("GET", _entries(), query={"scope": _scope(ctx)})
    items = resp.get("entries", [])
    return "\n".join(f"- {e['path']}: {e.get('description', '')}" for e in items) or "No memories yet."


@function_tool(strict_mode=False)
async def update_memory(
    ctx: RunContextWrapper[MemoryContext],
    path: str,
    str_replace: dict | None = None,
    insert: dict | None = None,
    replace_all: dict | None = None,
) -> str:
    """Edit an EXISTING memory's contents in place (not its path or description) — use this to revise
    a stored fact instead of duplicating via save_memory. Entry must exist; get_memory first so the
    edit matches. Pass the exact /memories/... path + EXACTLY ONE op:
    - str_replace={"old_str","new_str"}: replace old_str (must occur exactly once, char-for-char).
    - insert={"insert_text", optional "insert_line"}: add text; omit insert_line to append, 0 = top.
    - replace_all={"contents"}: overwrite the whole body.
    Path absent → save_memory; memory obsolete → delete_memory."""
    op = {
        k: v
        for k, v in (("str_replace", str_replace), ("insert", insert), ("replace_all", replace_all))
        if v
    }
    if len(op) != 1:
        return "Pass exactly one of str_replace / insert / replace_all."
    try:
        _do("PATCH", _entries(), body={"scope": _scope(ctx), "path": path, **op})
    except DatabricksError as e:
        if e.error_code == "NOT_FOUND":
            return f"No memory at {path} to update — check the path (list_memories) or save it first."
        raise
    return f"Updated {path}."


@function_tool
async def delete_memory(ctx: RunContextWrapper[MemoryContext], path: str) -> str:
    """Permanently remove ONE memory by its exact path (from list_memories). Use for stale, wrong,
    superseded, or duplicate entries, or when the user asks to forget something. Don't delete just to
    rewrite a valid fact — use update_memory. Irreversible."""
    try:
        _do("DELETE", _entries(), query={"scope": _scope(ctx), "path": path})
    except DatabricksError as e:
        if e.error_code == "NOT_FOUND":
            return f"No memory at {path} (already gone)."
        raise
    return f"Deleted {path}."


# Search is NOT registered (recall is list_memories -> get_memory). Kept as a defined function for
# when semantic search is onboarded; today the API does an O(N) case-insensitive keyword scan over a
# user's entries. To enable: add `search_memory` to MEMORY_TOOLS and update the agent instructions.
@function_tool
async def search_memory(ctx: RunContextWrapper[MemoryContext], query: str, top_k: int = 5) -> str:
    """[Not registered] Keyword scan over the user's memories — recall goes through list_memories +
    get_memory instead. Kept for future use once semantic search lands."""
    resp = _do(
        "POST", _entries(":search"), body={"scope": _scope(ctx), "query": query, "top_k": top_k}
    )
    hits = resp.get("results", [])
    return "\n".join(f"- {h['memory_entry']['path']}: {h['memory_entry'].get('contents', '')}" for h in hits) or "No memories found."


MEMORY_TOOLS = [save_memory, get_memory, list_memories, update_memory, delete_memory]
