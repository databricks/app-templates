"""Security headers on every response, the API's and the frontend's."""

from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers: CSP, nosniff, Referrer-Policy, HSTS."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        csp = (
            "default-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; frame-ancestors 'none'"
        )
        response.headers["Content-Security-Policy"] = csp
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response
