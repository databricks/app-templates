"""Long-term memory for the agent via the Mem0 hosted REST API.

These are plain OpenAI Agents SDK function tools that call api.mem0.ai directly with
httpx — no mem0 SDK. They complement the template's short-term Lakebase session memory
(the verbatim transcript of one conversation) by giving the agent durable, semantic,
cross-conversation recall that it reads and writes explicitly.

Endpoints (verified live against api.mem0.ai, June 2026):
    add (async):   POST   {BASE}/v3/memories/add/      -> {status, event_id}
    search:        POST   {BASE}/v3/memories/search/   -> {results: [...]}
    list:          POST   {BASE}/v3/memories/          -> {count, results: [...]}
    delete by id:  DELETE {BASE}/v1/memories/{id}/
    poll event:    GET    {BASE}/v1/event/{event_id}/  -> {status}
    auth header:   "Authorization: Token <MEM0_API_KEY>"

Config: set MEM0_API_KEY in the environment (.env locally; an app env var on deploy).
Note: this is an external HTTP API, not a Databricks resource, so it needs NO grant in
databricks.yml — only the MEM0_API_KEY env var.
"""

import logging
import os
from dataclasses import dataclass

import httpx
from agents import RunContextWrapper, function_tool
from databricks.sdk import WorkspaceClient

from agent_server.utils import get_user_workspace_client

logger = logging.getLogger(__name__)

MEM0_BASE = os.getenv("MEM0_BASE_URL", "https://api.mem0.ai")
_TIMEOUT = httpx.Timeout(30.0)


def _headers() -> dict[str, str]:
    key = os.getenv("MEM0_API_KEY")
    if not key:
        raise RuntimeError("MEM0_API_KEY is not set — add it to .env or the app env.")
    return {"Authorization": f"Token {key}", "Content-Type": "application/json"}


@dataclass
class Mem0Context:
    """Per-request run context. `user_id` decides whose memories the tools read and
    write. It is injected by the handler (see get_mem0_user_id) and is NOT part of the
    tool schema the model sees, so the LLM cannot read or write another user's memory."""

    user_id: str


def get_mem0_user_id() -> str:
    """Resolve a stable per-user id (the Databricks username/email) to scope memories.

    IMPORTANT: get_user_workspace_client() returns a WorkspaceClient authenticated AS
    the end user via the OBO forwarded token — it is a *client*, not an id. To get the
    id we ask Databricks who that client belongs to: current_user.me().user_name.

    Falls back to the app's own identity when there is no forwarded user token (e.g.
    local dev or OBO not enabled), and finally to a constant so the agent still works.
    """
    try:
        return get_user_workspace_client().current_user.me().user_name
    except Exception:
        logger.warning("No forwarded user token; using app identity for mem0 scope.", exc_info=True)
        try:
            return WorkspaceClient().current_user.me().user_name
        except Exception:
            logger.warning("Could not resolve any Databricks identity for mem0.", exc_info=True)
            return "default_user"


async def _post(path: str, payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(f"{MEM0_BASE}{path}", headers=_headers(), json=payload)
        r.raise_for_status()
        return r.json()


@function_tool
async def save_memory(wrapper: RunContextWrapper[Mem0Context], text: str) -> str:
    """Save a durable fact about the user for future conversations — preferences,
    important personal details, or decisions. Use this whenever the user shares
    something worth remembering long-term."""
    try:
        data = await _post(
            "/v3/memories/add/",
            {
                "messages": [{"role": "user", "content": text}],
                "user_id": wrapper.context.user_id,
                # "infer": False,  # set False to store `text` verbatim instead of letting mem0 rewrite/extract
            },
        )
    except httpx.HTTPError as e:
        return f"Failed to save memory: {e}"
    # v3 add runs in the background (PENDING -> RUNNING -> SUCCEEDED); the memory is
    # usually searchable within a minute (eventually consistent).
    return f"Memory saved (processing, status={data.get('status', 'PENDING')})."


@function_tool
async def search_memory(wrapper: RunContextWrapper[Mem0Context], query: str, limit: int = 5) -> str:
    """Search the user's long-term memories for facts relevant to a question. Call this
    before answering anything that may depend on the user's preferences or past statements."""
    try:
        data = await _post(
            "/v3/memories/search/",
            {"query": query, "filters": {"user_id": wrapper.context.user_id}, "top_k": limit},
        )
    except httpx.HTTPError as e:
        return f"Failed to search memory: {e}"
    results = data.get("results", [])
    return "\n".join(f"- {m['memory']}" for m in results) or "No relevant memories found."


@function_tool
async def list_memories(wrapper: RunContextWrapper[Mem0Context], limit: int = 50) -> str:
    """List everything currently remembered about the user, with ids you can pass to delete_memory."""
    try:
        data = await _post(
            f"/v3/memories/?page=1&page_size={limit}",
            {"filters": {"user_id": wrapper.context.user_id}},
        )
    except httpx.HTTPError as e:
        return f"Failed to list memories: {e}"
    results = data.get("results", [])
    return "\n".join(f"- {m['memory']} (id={m['id']})" for m in results) or "No memories stored yet."


@function_tool
async def delete_memory(memory_id: str) -> str:
    """Delete a single memory by its id (ids come from list_memories)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            r = await client.delete(f"{MEM0_BASE}/v1/memories/{memory_id}/", headers=_headers())
            r.raise_for_status()
        except httpx.HTTPError as e:
            return f"Failed to delete memory: {e}"
    return f"Deleted memory {memory_id}."


# Convenience: register all four with the agent via `tools=[get_current_time, *MEMORY_TOOLS]`.
MEMORY_TOOLS = [save_memory, search_memory, list_memories, delete_memory]
