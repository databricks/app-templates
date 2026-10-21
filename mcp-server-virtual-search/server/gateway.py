"""Clients for the two Databricks APIs this app calls, always with the user's token.

- The AI Gateway MCP proxy (``POST {host}/ai-gateway/mcp-services/{name}``) speaks
  MCP JSON-RPC to each Unity Catalog MCP service. Needs the ``ai-gateway`` scope.
- The Unity Catalog per-user credential API
  (``GET /api/2.1/unity-catalog/mcp-services/{name}/user-credentials``) reads whether
  the user has signed in to a service. Needs the ``unity-catalog:read`` scope; without
  it the app still works, minus the "no sign-in needed" labels.
"""

from __future__ import annotations

import json
import uuid
from enum import Enum
from typing import Any
from urllib.parse import quote

import httpx

from .request_context import databricks_host

_MCP_PROTOCOL_VERSION = "2025-06-18"
_CREDENTIALS_PATH = "/api/2.1/unity-catalog/mcp-services/{name}/user-credentials"
# The AI Gateway's JSON-RPC error code for "you are not signed in to this MCP service".
_NOT_SIGNED_IN = -32042


class UpstreamError(Exception):
    """A JSON-RPC or HTTP error from an MCP service."""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    @property
    def needs_login(self) -> bool:
        return self.code == _NOT_SIGNED_IN


def _parse_jsonrpc(resp: httpx.Response, rpc_id: str) -> dict:
    """Extract the JSON-RPC response from a JSON or text/event-stream body."""
    if "text/event-stream" not in resp.headers.get("content-type", ""):
        return resp.json()
    fallback = None
    for line in resp.text.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            msg = json.loads(line[len("data:") :])
        except json.JSONDecodeError:
            continue
        if isinstance(msg, dict) and msg.get("id") == rpc_id:
            return msg
        if isinstance(msg, dict) and ("result" in msg or "error" in msg):
            fallback = msg
    if fallback is None:
        raise UpstreamError(-32000, "no JSON-RPC response in the event stream")
    return fallback


class GatewayMcpClient:
    """MCP client for Unity Catalog MCP services, reached through the AI Gateway."""

    def __init__(
        self, token: str, timeout: float = 60.0, transport: httpx.AsyncBaseTransport | None = None
    ):
        self._token = token
        self._host = databricks_host()
        self._http = httpx.AsyncClient(timeout=timeout, transport=transport)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _rpc(self, service: str, method: str, params: dict | None, session_id: str | None):
        """One JSON-RPC exchange. Every failure, including transport errors and
        malformed replies, raises UpstreamError, so one broken service can't fail a
        listing of all of them."""
        try:
            return await self._rpc_unchecked(service, method, params, session_id)
        except (httpx.HTTPError, ValueError, AttributeError, TypeError) as e:
            raise UpstreamError(-32000, f"{type(e).__name__}: {e}") from e

    async def _rpc_unchecked(
        self, service: str, method: str, params: dict | None, session_id: str | None
    ):
        rpc_id = uuid.uuid4().hex
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": rpc_id, "method": method}
        if params is not None:
            body["params"] = params
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": _MCP_PROTOCOL_VERSION,
        }
        if session_id:
            headers["Mcp-Session-Id"] = session_id
        resp = await self._http.post(
            f"{self._host}/ai-gateway/mcp-services/{quote(service, safe='')}",
            json=body,
            headers=headers,
        )
        session_id = resp.headers.get("mcp-session-id") or session_id
        if method.startswith("notifications/"):
            return {}, session_id
        is_stream = "text/event-stream" in resp.headers.get("content-type", "")
        if resp.status_code >= 400 and not is_stream:
            try:
                err = resp.json().get("error")
            except ValueError:
                err = None
            if isinstance(err, dict) and "code" in err:
                raise UpstreamError(err["code"], err.get("message", ""))
            raise UpstreamError(-32000, f"HTTP {resp.status_code}: {resp.text[:300]}")
        msg = _parse_jsonrpc(resp, rpc_id)
        if not isinstance(msg, dict):
            raise UpstreamError(-32000, "the reply is not a JSON-RPC object")
        if "error" in msg:
            err = msg["error"] if isinstance(msg["error"], dict) else {"message": str(msg["error"])}
            raise UpstreamError(err.get("code", -32000), err.get("message", ""))
        result = msg.get("result", {})
        if not isinstance(result, dict):
            raise UpstreamError(-32000, "the JSON-RPC result is not an object")
        return result, session_id

    async def _initialize(self, service: str) -> str | None:
        """MCP handshake; returns the session id when the service issues one. The
        gateway also accepts calls without it, so a failed handshake falls through to
        the real call, which reports the actual error."""
        params = {
            "protocolVersion": _MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "databricks-virtual-mcp-search-server", "version": "0.1.0"},
        }
        try:
            _, session_id = await self._rpc(service, "initialize", params, None)
            if session_id:
                await self._rpc(service, "notifications/initialized", None, session_id)
        except UpstreamError:
            return None
        return session_id

    async def list_tools(self, service: str) -> list[dict]:
        session_id = await self._initialize(service)
        result, _ = await self._rpc(service, "tools/list", {}, session_id)
        tools = result.get("tools", [])
        if not isinstance(tools, list):
            raise UpstreamError(-32000, "tools/list returned no tool list")
        return [t for t in tools if isinstance(t, dict)]

    async def call_tool(self, service: str, tool: str, arguments: dict) -> dict:
        session_id = await self._initialize(service)
        result, _ = await self._rpc(
            service, "tools/call", {"name": tool, "arguments": arguments}, session_id
        )
        return result


class Credential(str, Enum):
    """The user's stored credential for one MCP service."""

    ACTIVE = "ACTIVE"
    NONE = "NONE"
    NOT_REQUIRED = "NOT_REQUIRED"


async def credential_state(token: str, service: str) -> Credential | None:
    """None when it can't be determined, e.g. the app lacks the unity-catalog:read scope
    or Unity Catalog is throttling."""
    url = databricks_host() + _CREDENTIALS_PATH.format(name=quote(service, safe=""))
    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            resp = await http.get(url, headers={"Authorization": f"Bearer {token}"})
        if resp.status_code == 200:
            state = (resp.json().get("provisioning_info") or {}).get("state")
            return Credential.ACTIVE if state == "ACTIVE" else Credential.NONE
    except (httpx.HTTPError, ValueError):
        return None
    if resp.status_code == 404:
        return Credential.NONE
    if resp.status_code == 400:  # the service takes no per-user credential
        return Credential.NOT_REQUIRED
    return None
