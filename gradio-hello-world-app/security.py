"""Security headers and CSRF protection for this app.

The Databricks Apps proxy handles login and TLS but does not add security
headers or check where requests come from, so this ASGI middleware does both:

- Adds a Content-Security-Policy (including ``frame-ancestors 'none'``) and
  related headers to every HTTP response.
- Rejects state-changing requests (POST, PUT, PATCH, DELETE) and WebSocket
  connections whose ``Origin`` is not this app's URL (``DATABRICKS_APP_URL``)
  or listed in ``ALLOWED_ORIGINS`` (comma-separated). A missing Origin is
  allowed (non-browser clients); ``Origin: null`` is always rejected.
"""

import logging
import os
import re

from starlette.datastructures import MutableHeaders

logger = logging.getLogger(__name__)

CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self' https: wss:",
        # Gradio's page embeds its config in inline scripts and its plot
        # components evaluate code at runtime, so both must be allowed.
        "script-src 'self' https: 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' https: 'unsafe-inline'",
        "img-src 'self' https: data: blob:",
        "font-src 'self' https: data:",
        "object-src 'none'",
        "base-uri 'self'",
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
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
