"""
Main entry point for the MCP server application.

This module provides the main() function that starts the uvicorn server.
It's configured as the entry point in pyproject.toml, so you can run the server
using the command: custom-mcp-server

The server uses uvicorn (an ASGI server) to serve the FastAPI/FastMCP application.
"""

import argparse

import uvicorn


def main():
    """
    Start the MCP server using uvicorn.

    This function is the main entry point for the application. It configures and
    starts the uvicorn ASGI server with the combined FastAPI/FastMCP application.

    Configuration:
        - host: "0.0.0.0" - Binds to all network interfaces, allowing external connections
        - port: Configurable via --port argument (default: 8000)

    Usage:
        Run with default port: uv run custom-mcp-server
        Run with custom port: uv run custom-mcp-server --port 8080
    """
    parser = argparse.ArgumentParser(description="Start the MCP server")
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to run the server on (default: 8000)"
    )
    args = parser.parse_args()

    uvicorn.run(
        "server.app:combined_app",  # Import path to the combined FastAPI application
        host="0.0.0.0",  # Listen on all network interfaces
        port=args.port,  # Port from command line argument or default
    )
