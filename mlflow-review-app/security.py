"""Security headers and CSRF protection for this app. Template-owned.

The Databricks Apps proxy handles login and TLS but does not add security
headers or check where requests come from, so this ASGI middleware does both:

- Adds a Content-Security-Policy (including ``frame-ancestors 'none'``) and
  related headers to every HTTP response.
- Rejects state-changing requests (POST, PUT, PATCH, DELETE) and WebSocket
  connections whose ``Origin`` is not this app's URL (``DATABRICKS_APP_URL``)
  or listed in ``ALLOWED_ORIGINS`` (comma-separated). A missing Origin is
  allowed (non-browser clients); ``Origin: null`` is always rejected.
- Rejects request bodies over ``MAX_BODY_BYTES`` with 413, so one request
  cannot fill the app's memory.
"""

import logging
import os
import re

from starlette.datastructures import MutableHeaders

logger = logging.getLogger(__name__)

CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self' https: wss:",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "connect-src 'self' https: wss:",
        "frame-ancestors 'none'",
    ]
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
}

STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# The review API takes small JSON bodies; 1 MiB leaves plenty of room.
MAX_BODY_BYTES = 1024 * 1024
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

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        async def reject(status, text):
            await send_with_headers(
                {"type": "http.response.start", "status": status, "headers": [(b"content-type", b"text/plain")]}
            )
            await send({"type": "http.response.body", "body": text})

        is_websocket = scope["type"] == "websocket"
        if is_websocket or scope["method"] in STATE_CHANGING_METHODS:
            origin = next(
                (value.decode("latin-1") for key, value in scope["headers"] if key == b"origin"),
                None,
            )
            if not is_origin_allowed(origin):
                logger.warning("Rejected cross-origin request to %r from %r", scope["path"], origin)
                if is_websocket:
                    await receive()
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    await reject(403, b"Forbidden")
                return

        if is_websocket:
            return await self.app(scope, receive, send)

        # Read the whole body before the app runs, and stop at the limit. Chunked bodies have no
        # Content-Length, so count the bytes instead of trusting the header.
        body = b""
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body += message.get("body", b"")
            if len(body) > MAX_BODY_BYTES:
                return await reject(413, b"Request body too large")
            more_body = message.get("more_body", False)

        replayed = False

        async def replay():
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send_with_headers)
