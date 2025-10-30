"""Custom OpenAPI Spec MCP Server"""

import logging

from .app import combined_app

__all__ = ["combined_app"]

logger = logging.getLogger(__name__)


def main() -> None:
    """Main entry point for the server"""
    logger.info("Custom OpenAPI Spec MCP Server initialized")
