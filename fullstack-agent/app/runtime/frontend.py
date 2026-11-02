"""Serve the built frontend."""

from pathlib import Path

from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp

COMPRESS_FROM_BYTES = 1000


def frontend(directory: Path) -> ASGIApp:
    """Serve built frontend with gzip compression."""
    return GZipMiddleware(
        StaticFiles(directory=directory, html=True), minimum_size=COMPRESS_FROM_BYTES
    )
