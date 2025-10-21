"""
Main entry point for the MCP server application.

This module provides the main() function that starts the uvicorn server.
It's configured as the entry point in pyproject.toml, so you can run the server
using the command: custom-mcp-server

The server uses uvicorn (an ASGI server) to serve the FastAPI/FastMCP application.
"""

import uvicorn


def main():
    """
    Start the MCP server using uvicorn.

    This function is the main entry point for the application. It configures and
    starts the uvicorn ASGI server with the combined FastAPI/FastMCP application.

    Configuration:
        - host: "0.0.0.0" - Binds to all network interfaces, allowing external connections
        - port: 8000 - The port the server listens on

    Usage:
        Run directly: uv run custom-mcp-server
    """
    uvicorn.run(
        "server.app:combined_app",  # Import path to the combined FastAPI application
        host="0.0.0.0",  # Listen on all network interfaces
        port=8000,  # Default port (can be overridden via environment variables)
    )
