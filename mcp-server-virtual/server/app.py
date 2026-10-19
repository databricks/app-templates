"""HTTP surface of the virtual MCP server.

- ``/mcp`` and ``/mcp/search``: the two MCP servers (streamable HTTP), see proxy.py.
- ``/``: an explorer UI to sign in to each service, browse, search and try tools.
- ``/api/*``: JSON endpoints behind the UI.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, Field

from . import config, proxy, tool_index
from .gateway import credential_state, revoke_credential
from .request_context import (
    databricks_host,
    public_app_url,
    running_in_databricks_apps,
    user_token,
)

logging.basicConfig(level=logging.INFO)

STATIC_DIR = Path(__file__).parent / "static"


def _session_manager(server) -> StreamableHTTPSessionManager:
    return StreamableHTTPSessionManager(
        app=server,
        # Reply with plain JSON rather than an SSE frame: some MCP clients (e.g. the
        # AI Playground) only accept application/json. This server never sends
        # server-to-client requests, which JSON mode rules out.
        json_response=True,
        # Every request stands alone, so any app replica can serve it.
        stateless=True,
        # The Apps proxy serves the app on a *.databricksapps.com host, which the
        # localhost-oriented DNS-rebinding allowlist would reject.
        security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )


_all_tools_manager = _session_manager(proxy.all_tools_server)
_search_manager = _session_manager(proxy.search_server)


@contextlib.asynccontextmanager
async def _lifespan(_: FastAPI):
    config.load()
    # Off the event loop: a slow Unity Catalog must not delay serving.
    volume_load = asyncio.create_task(asyncio.to_thread(config.refresh_from_volume))
    async with _all_tools_manager.run(), _search_manager.run():
        yield
    volume_load.cancel()


app = FastAPI(title="Virtual MCP Server", lifespan=_lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _require_token(request: Request) -> str | JSONResponse:
    token = user_token(request.headers)
    if token:
        return token
    return JSONResponse(
        {"error": "No user token. Enable user authorization (on-behalf-of-user) for this app."},
        status_code=401,
    )


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/services")
async def api_services(request: Request, name: str | None = None):
    """Each configured service with its sign-in state and exposed tools. Pass ``name``
    to check one service (the UI polls this while the user signs in)."""
    token = _require_token(request)
    if isinstance(token, JSONResponse):
        return token
    listings = await proxy.list_services(token, only=name)
    credentials = await asyncio.gather(
        *(credential_state(token, l.selection.name) for l in listings)
    )
    services = []
    for listing, credential in zip(listings, credentials, strict=True):
        if listing.needs_login:
            state = "NEEDS_LOGIN"
        elif listing.error:
            state = "ERROR"
        else:
            state = "CONNECTED"
        services.append(
            {
                "name": listing.selection.name,
                "alias": listing.selection.alias,
                "state": state,
                "credential": credential.value if credential else None,
                "error": listing.error,
                "tools": [
                    {
                        "name": tool.name,
                        "description": tool.description or "",
                        "input_schema": tool.input_schema or {"type": "object"},
                    }
                    for tool in listing.tools
                ],
            }
        )
    return {
        "services": services,
        "config_source": config.load().source,
        "login_url": f"{databricks_host()}/mcp-service-login",
    }


class CallRequest(BaseModel):
    name: str
    arguments: dict = Field(default_factory=dict)


@app.post("/api/call")
async def api_call(request: Request, body: CallRequest):
    """Run one tool by its namespaced name, as the /mcp server would."""
    token = _require_token(request)
    if isinstance(token, JSONResponse):
        return token
    result = await proxy.call_tool(
        token, body.name, body.arguments, public_app_url(request.headers)
    )
    text = "\n".join(
        block.get("text", "") if block.get("type") == "text" else str(block)
        for block in result.content
    )
    return {"ok": result.ok, "text": text, "error": result.error, "needs_login": result.needs_login}


class RevokeRequest(BaseModel):
    name: str


@app.post("/api/revoke")
async def api_revoke(request: Request, body: RevokeRequest):
    """Delete the caller's stored credential for one service. Needs the app to have
    the unity-catalog user scope."""
    token = _require_token(request)
    if isinstance(token, JSONResponse):
        return token
    if body.name not in {s.name for s in config.load().services}:
        return JSONResponse({"error": f"'{body.name}' is not configured"}, status_code=400)
    status, detail = await revoke_credential(token, body.name)
    # 404: there was no credential to revoke.
    return {"ok": status < 400 or status == 404, "status": status, "detail": detail}


@app.get("/api/search")
async def api_search(request: Request, q: str = Query(min_length=1), n: int | None = None):
    """The ranking that the search_tools tool on /mcp/search returns."""
    token = _require_token(request)
    if isinstance(token, JSONResponse):
        return token
    return await proxy.search_tools(token, q, n)


@app.get("/api/index-status")
async def api_index_status():
    return await asyncio.to_thread(tool_index.status)


# The MCP endpoints bypass FastAPI routing: a Starlette Mount would 307-redirect
# "/mcp" to "/mcp/" using the internal host (localhost:8000), which clients can't follow.
_MCP_ROUTES = {"/mcp": _all_tools_manager, "/mcp/search": _search_manager}
_ACCEPT_JSON_AND_SSE = b"application/json, text/event-stream"
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def _is_loopback_host(scope) -> bool:
    host = dict(scope.get("headers", [])).get(b"host", b"").decode().lower()
    if host.startswith("["):  # IPv6, e.g. "[::1]:8000"
        hostname = host.split("]", 1)[0] + "]"
    else:
        hostname = host.split(":", 1)[0]
    return hostname in _LOOPBACK_HOSTS


async def application(scope, receive, send):
    """ASGI entrypoint."""
    # Locally, a request without a forwarded token runs as the developer. Refuse
    # non-loopback Host headers so a DNS-rebinding web page can't use that.
    if (
        scope["type"] == "http"
        and not running_in_databricks_apps()
        and not _is_loopback_host(scope)
    ):
        await JSONResponse({"error": "local development accepts only localhost"}, 403)(
            scope, receive, send
        )
        return
    manager = (
        _MCP_ROUTES.get(scope.get("path", "").rstrip("/")) if scope["type"] == "http" else None
    )
    if manager is None:
        await app(scope, receive, send)
        return
    # The transport rejects (406) a request whose Accept header doesn't list both
    # JSON and SSE. Replies are JSON either way, so accept any client.
    scope = {
        **scope,
        "headers": [(k, v) for k, v in scope.get("headers", []) if k != b"accept"]
        + [(b"accept", _ACCEPT_JSON_AND_SSE)],
    }
    await manager.handle_request(scope, receive, send)
