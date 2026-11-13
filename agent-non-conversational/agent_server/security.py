"""Security headers and CSRF protection for this app.

The Databricks Apps proxy handles login and TLS but does not add security
headers or check where requests come from, so this ASGI middleware does both:

- Adds a Content-Security-Policy (including ``frame-ancestors 'none'``) and
  related headers to every HTTP response.
- Rejects state-changing requests (POST, PUT, PATCH, DELETE) and WebSocket
  connections whose ``Origin`` is not this app's URL (``DATABRICKS_APP_URL``)
  or listed in ``ALLOWED_ORIGINS`` (comma-separated). A missing Origin is
  allowed (non-browser clients); ``Origin: null`` is always rejected.

``RequestValidationMiddleware`` rejects oversized agent requests with a 400.
"""

import json
import logging
import os
import re

from starlette.datastructures import MutableHeaders
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self' https: wss:",
        "script-src 'self' https:",
        "style-src 'self' https: 'unsafe-inline'",
        "img-src 'self' https: data: blob:",
        "font-src 'self' https: data:",
        "object-src 'none'",
        "base-uri 'self'",
        "connect-src 'self' https: wss:",
        "frame-ancestors 'none'",
    ]
)

# FastAPI's Swagger UI pages start from an inline <script> that embeds the OpenAPI URL,
# and ReDoc runs its search in a blob: worker; only these paths get either.
DOCS_PATHS = {"/docs", "/docs/oauth2-redirect", "/redoc"}
DOCS_CONTENT_SECURITY_POLICY = (
    CONTENT_SECURITY_POLICY.replace(
        "script-src 'self' https:", "script-src 'self' https: 'unsafe-inline'"
    )
    + "; worker-src 'self' blob:"
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
}

STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
ORIGIN_FORMAT = re.compile(r"^https://[a-zA-Z0-9\-.]+(:[0-9]{1,5})?$")
LOCALHOST_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$")


def _normalize(origin: str) -> str:
    return origin.strip().lower().rstrip("/")


def _allowed_origins() -> set[str]:
    origins = [os.environ.get("DATABRICKS_APP_URL", "")]
    origins += os.environ.get("ALLOWED_ORIGINS", "").split(",")
    return {_normalize(origin) for origin in origins if origin.strip()}


def is_origin_allowed(origin: str | None) -> bool:
    if not origin:
        return True
    if origin == "null":
        return False
    if ORIGIN_FORMAT.match(origin) and _normalize(origin) in _allowed_origins():
        return True
    # Local development: the app isn't behind the Databricks Apps proxy.
    return not os.environ.get("DATABRICKS_APP_URL") and bool(LOCALHOST_ORIGIN.match(origin))


class SecurityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)

        is_websocket = scope["type"] == "websocket"
        if is_websocket or scope["method"] in STATE_CHANGING_METHODS:
            origin = next(
                (value.decode("latin-1") for key, value in scope["headers"] if key == b"origin"),
                None,
            )
            if not is_origin_allowed(origin):
                logger.warning("Rejected cross-origin request to %s from %s", scope["path"], origin)
                if is_websocket:
                    await receive()
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    await send(
                        {
                            "type": "http.response.start",
                            "status": 403,
                            "headers": [(b"content-type", b"text/plain")],
                        }
                    )
                    await send({"type": "http.response.body", "body": b"Forbidden"})
                return

        if is_websocket:
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if scope["path"] in DOCS_PATHS:
                    headers.setdefault("Content-Security-Policy", DOCS_CONTENT_SECURITY_POLICY)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


VALIDATED_PATHS = {"/invocations", "/responses"}


class RequestValidationMiddleware:
    """Return 400 for POST /invocations and /responses bodies that ``validate`` rejects.

    AgentServer turns any exception raised in an invoke or stream handler into a 500 or
    an SSE error event, so client errors have to be caught before the request reaches it.
    ``validate`` receives the parsed JSON body and raises ``ValueError`` to reject it.
    """

    def __init__(self, app, validate):
        self.app = app
        self.validate = validate

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or scope["path"] not in VALIDATED_PATHS
        ):
            return await self.app(scope, receive, send)

        chunks = []
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)

        try:
            data = json.loads(body)
        except ValueError:
            # AgentServer answers malformed JSON with its own 400.
            data = None
        if isinstance(data, dict):
            try:
                self.validate(data)
            except ValueError as e:
                response = JSONResponse({"detail": str(e)}, status_code=400)
                return await response(scope, receive, send)

        body_sent = False

        async def replay_body():
            nonlocal body_sent
            if body_sent:
                return await receive()
            body_sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay_body, send)
