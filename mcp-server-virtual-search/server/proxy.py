"""The two MCP servers this app serves.

- ``/mcp`` lists every selected tool of every configured service, named
  ``{alias}__{tool}`` so names never collide and each call routes back to its service.
- ``/mcp/search`` lists only ``search_tools`` and ``call_tool``, so an agent loads a
  handful of relevant tool schemas instead of all of them.

Both use the low-level MCP server API: the tool list depends on who is calling, which
decorator-registered tools can't express.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from urllib.parse import quote

import mcp.types as types
from mcp.server.lowlevel import Server

from . import config, tool_index
from .gateway import GatewayMcpClient, UpstreamError
from .request_context import databricks_host, public_app_url, running_in_databricks_apps, user_token

log = logging.getLogger(__name__)

SEPARATOR = "__"
SEARCH_TOOL_NAME = "search_tools"
CALL_TOOL_NAME = "call_tool"
# How long a caller's listing is reused for search. A search lists every service, so
# without this each search would fan out to all of them.
_LISTING_CACHE_TTL_S = 60


@dataclass
class ServiceListing:
    selection: config.ServiceSelection
    tools: list[types.Tool] = field(default_factory=list)
    needs_login: bool = False
    error: str | None = None

    @property
    def ok(self) -> bool:
        return not self.needs_login and self.error is None


async def _list_service(
    client: GatewayMcpClient, selection: config.ServiceSelection
) -> ServiceListing:
    listing = ServiceListing(selection)
    try:
        upstream_tools = await client.list_tools(selection.name)
    except UpstreamError as e:
        listing.needs_login = e.needs_login
        listing.error = None if e.needs_login else e.message
        return listing
    for tool in upstream_tools:
        name, schema = tool.get("name"), tool.get("inputSchema")
        if not isinstance(name, str) or not name or not selection.matches(name):
            continue
        listing.tools.append(
            types.Tool(
                name=f"{selection.alias}{SEPARATOR}{name}",
                description=f"[{selection.alias}] {tool.get('description') or ''}".strip(),
                inputSchema=schema if isinstance(schema, dict) else {"type": "object"},
            )
        )
    return listing


async def list_services(token: str, only: str | None = None) -> list[ServiceListing]:
    """List each configured service's exposed tools, in parallel. Also refreshes the
    search index in the background."""
    selections = [s for s in config.load().services if only is None or s.name == only]
    client = GatewayMcpClient(token)
    try:
        listings = list(await asyncio.gather(*(_list_service(client, s) for s in selections)))
    finally:
        await client.aclose()
    _schedule_index_sync(listings)
    return listings


def _index_rows(listings: list[ServiceListing]) -> list[dict]:
    return [
        {
            "name": tool.name,
            "alias": listing.selection.alias,
            "description": tool.description or "",
            "input_schema": tool.input_schema or {"type": "object"},
        }
        for listing in listings
        for tool in listing.tools
    ]


async def _sync_index(listings: list[ServiceListing]) -> None:
    rows = _index_rows(listings)
    if rows:
        await asyncio.to_thread(tool_index.sync, rows)


# Strong references, so pending background syncs aren't garbage-collected.
_background_syncs: set[asyncio.Task] = set()


def _schedule_index_sync(listings: list[ServiceListing]) -> None:
    async def run() -> None:
        try:
            await _sync_index(listings)
        except Exception:  # noqa: BLE001 -- a failed index refresh must not fail a listing
            log.exception("tool index sync failed")

    task = asyncio.create_task(run())
    _background_syncs.add(task)
    task.add_done_callback(_background_syncs.discard)


def _not_signed_in_message(service: str, app_url: str | None) -> str:
    sign_in = f"{databricks_host()}/mcp-service-login?name={quote(service, safe='')}"
    where = f"open {app_url} and click Sign in, or " if app_url else ""
    return f"You are not signed in to the '{service}' MCP service. To fix this, {where}sign in at {sign_in}, then retry."


@dataclass
class CallResult:
    ok: bool
    content: list[dict] = field(default_factory=list)
    error: str | None = None
    needs_login: bool = False


async def call_tool(
    token: str, name: str, arguments: dict, app_url: str | None = None
) -> CallResult:
    """Route a namespaced ``alias__tool`` call to the service that owns it."""
    alias, _, tool = name.partition(SEPARATOR)
    selection = config.load().by_alias(alias)
    if selection is None or not tool or not selection.matches(tool):
        return CallResult(ok=False, error=f"Unknown tool '{name}'.")
    client = GatewayMcpClient(token)
    try:
        result = await client.call_tool(selection.name, tool, arguments)
    except UpstreamError as e:
        if e.needs_login:
            return CallResult(
                ok=False, error=_not_signed_in_message(selection.name, app_url), needs_login=True
            )
        return CallResult(ok=False, error=f"{selection.name} returned error {e.code}: {e.message}")
    finally:
        await client.aclose()
    return CallResult(ok=not result.get("isError", False), content=result.get("content") or [])


# sha256(token) -> (expiry, the caller's tools by name). Hashed so tokens aren't kept.
_listing_cache: dict[str, tuple[float, dict[str, types.Tool]]] = {}


async def _caller_tools(token: str) -> dict[str, types.Tool]:
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    cached = _listing_cache.get(key)
    if cached and cached[0] > now:
        return cached[1]
    listings = await list_services(token)
    tools = {tool.name: tool for listing in listings for tool in listing.tools}
    if not await asyncio.to_thread(tool_index.count):
        await _sync_index(listings)  # nothing to rank against yet; index before searching
    for expired in [k for k, (expiry, _) in _listing_cache.items() if expiry <= now]:
        del _listing_cache[expired]
    _listing_cache[key] = (now + _LISTING_CACHE_TTL_S, tools)
    return tools


def _clamp_top_n(top_n: object) -> int:
    try:
        n = int(top_n) if top_n not in (None, "") else tool_index.DEFAULT_TOP_N
    except (TypeError, ValueError):
        n = tool_index.DEFAULT_TOP_N
    return max(1, min(n, tool_index.MAX_TOP_N))


async def search_tools(token: str, query: str, top_n: object = None) -> dict:
    """The best top_n tools for query among those the caller can list right now."""
    tools = await _caller_tools(token)
    ranked = await asyncio.to_thread(tool_index.search, query, _clamp_top_n(top_n), list(tools))
    hits = [
        {
            "name": name,
            "description": tools[name].description or "",
            "input_schema": tools[name].input_schema or {"type": "object"},
            "score": score,
        }
        for name, score in ranked
    ]
    return {"tools": hits, "backend": tool_index.backend()}


# --------------------------------------------------------------------------- #
# MCP handlers
# --------------------------------------------------------------------------- #


def _caller(ctx) -> tuple[str | None, str | None]:
    """(user token, this app's public URL) for an MCP request."""
    request = getattr(ctx, "request", None)
    if request is None:
        return (None if running_in_databricks_apps() else user_token({})), None
    return user_token(request.headers), public_app_url(request.headers)


def _error_result(message: str) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=message)], isError=True
    )


def _to_content_block(block: dict) -> types.ContentBlock:
    if block.get("type") == "text":
        return types.TextContent(type="text", text=block.get("text", ""))
    if block.get("type") == "image":
        return types.ImageContent(
            type="image", data=block.get("data", ""), mimeType=block.get("mimeType", "image/png")
        )
    return types.TextContent(type="text", text=json.dumps(block))


_NO_TOKEN = "No user token. Enable user authorization for this app (Databricks Apps forwards it)."


async def _on_list_tools(ctx, params) -> types.ListToolsResult:
    token, _ = _caller(ctx)
    if not token:
        return types.ListToolsResult(tools=[])
    listings = await list_services(token)
    return types.ListToolsResult(tools=[tool for listing in listings for tool in listing.tools])


async def _on_call_tool(ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
    token, app_url = _caller(ctx)
    if not token:
        return _error_result(_NO_TOKEN)
    result = await call_tool(token, params.name, params.arguments or {}, app_url)
    if result.error:
        return _error_result(result.error)
    blocks = [_to_content_block(b) for b in result.content] or [
        types.TextContent(type="text", text="")
    ]
    return types.CallToolResult(content=blocks, isError=not result.ok)


def _search_server_tools() -> list[types.Tool]:
    # Name the services: otherwise a model has no reason to believe, say, GitHub is
    # reachable through this server, and never searches for it.
    services = ", ".join(s.alias for s in config.load().services)
    return [
        types.Tool(
            name=SEARCH_TOOL_NAME,
            description=(
                f"Find the tools relevant to a task across these connected services: {services}. "
                "Searches every tool behind this server by meaning and keywords and returns the "
                "best matches with their input schemas. For a task with several steps, search "
                "once per step. Then run a returned tool with call_tool."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "What you want to do, e.g. 'find open pull requests assigned to me'.",
                    },
                    "top_n": {
                        "type": "integer",
                        "description": f"How many tools to return (default {tool_index.DEFAULT_TOP_N}, max {tool_index.MAX_TOP_N}).",
                    },
                },
                "required": ["query"],
            },
        ),
        types.Tool(
            name=CALL_TOOL_NAME,
            description=(
                "Run a tool returned by search_tools. Pass its exact name and an arguments "
                "object matching its input_schema."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "A tool name from search_tools, e.g. 'github__search_issues'.",
                    },
                    "arguments": {
                        "type": "object",
                        "description": "Arguments matching the tool's input_schema.",
                    },
                },
                "required": ["name"],
            },
        ),
    ]


async def _on_list_search_tools(ctx, params) -> types.ListToolsResult:
    return types.ListToolsResult(tools=_search_server_tools())


async def _on_call_search_tool(ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
    args = params.arguments or {}
    if params.name == CALL_TOOL_NAME:
        name, arguments = args.get("name"), args.get("arguments") or {}
        if not isinstance(name, str) or not name:
            return _error_result("call_tool needs 'name': a tool name returned by search_tools.")
        if isinstance(arguments, str):  # models often send the arguments as a JSON string
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                pass
        if not isinstance(arguments, dict):
            return _error_result("call_tool 'arguments' must be an object.")
        inner = types.CallToolRequestParams(name=name, arguments=arguments)
        return await _on_call_tool(ctx, inner)
    if params.name != SEARCH_TOOL_NAME:
        return _error_result(
            f"Unknown tool '{params.name}'. Use {SEARCH_TOOL_NAME} or {CALL_TOOL_NAME}."
        )
    token, app_url = _caller(ctx)
    if not token:
        return _error_result(_NO_TOKEN)
    query = str(args.get("query") or "").strip()
    if not query:
        return _error_result("search_tools needs a non-empty 'query'.")
    result = await search_tools(token, query, args.get("top_n"))
    if not result["tools"]:
        hint = f" Open {app_url} to sign in to the services." if app_url else ""
        return _error_result(
            f"No tools matched. You may not be signed in to any service yet.{hint}"
        )
    payload = [
        {"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]}
        for t in result["tools"]
    ]
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(payload, indent=1))]
    )


all_tools_server = Server("virtual-mcp", on_list_tools=_on_list_tools, on_call_tool=_on_call_tool)
search_server = Server(
    "virtual-mcp-search", on_list_tools=_on_list_search_tools, on_call_tool=_on_call_search_tool
)
