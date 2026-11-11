"""Security headers and CSRF protection for this app.

The Databricks Apps proxy handles login and TLS but does not add security
headers or check where requests come from, so ``init_app`` registers Flask
hooks that do both:

- Add a Content-Security-Policy (including ``frame-ancestors 'none'``) and
  related headers to every response.
- Reject state-changing requests (POST, PUT, PATCH, DELETE) whose ``Origin``
  is not this app's URL (``DATABRICKS_APP_URL``) or listed in
  ``ALLOWED_ORIGINS`` (comma-separated). A missing Origin is allowed
  (non-browser clients); ``Origin: null`` is always rejected.
"""

import logging
import os
import re

from flask import Flask, Response, request

logger = logging.getLogger(__name__)

STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
ORIGIN_FORMAT = re.compile(r"^https://[a-zA-Z0-9\-.]+(:[0-9]{1,5})?$")
LOCALHOST_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$")


def content_security_policy(extra_script_sources=()):
    return "; ".join(
        [
            "default-src 'self' https: wss:",
            " ".join(["script-src 'self' https:", *extra_script_sources]),
            "style-src 'self' https: 'unsafe-inline'",
            "img-src 'self' https: data: blob:",
            "font-src 'self' https: data:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "connect-src 'self' https: wss:",
            "frame-ancestors 'none'",
        ]
    )


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


def init_app(server: Flask, extra_script_sources=()) -> None:
    security_headers = {
        "Content-Security-Policy": content_security_policy(extra_script_sources),
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Cross-Origin-Opener-Policy": "same-origin",
    }

    @server.before_request
    def reject_cross_origin_requests():
        if request.method in STATE_CHANGING_METHODS:
            origin = request.headers.get("Origin")
            if not is_origin_allowed(origin):
                logger.warning("Rejected cross-origin %s %s from %s", request.method, request.path, origin)
                return Response("Forbidden", status=403, mimetype="text/plain")
        return None

    @server.after_request
    def add_security_headers(response):
        for name, value in security_headers.items():
            response.headers.setdefault(name, value)
        return response
