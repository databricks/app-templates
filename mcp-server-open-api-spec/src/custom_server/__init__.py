"""Custom OpenAPI Spec MCP Server"""

import logging

from .server import app

__all__ = ["app"]

logger = logging.getLogger(__name__)


def main() -> None:
    """Main entry point for the server"""
    logger.info("Custom OpenAPI Spec MCP Server initialized")
