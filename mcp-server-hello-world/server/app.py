"""
FastAPI application configuration for the MCP server.

This module sets up the core application by:
1. Creating and configuring the FastMCP server instance
2. Loading and registering all MCP tools
3. Setting up CORS middleware for cross-origin requests
4. Combining MCP routes with standard FastAPI routes
5. Optionally serving static files for a web frontend


The MCP (Model Context Protocol) server provides tools that can be called by
AI assistants and other clients. FastMCP makes it easy to expose these tools
over HTTP using the MCP protocol standard.
"""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastmcp import FastMCP

from .tools import load_tools
from .utils import header_store

mcp_server = FastMCP(name="custom-mcp-server")

# Load and register all tools with the MCP server
# Tools are defined in server/tools.py
load_tools(mcp_server)

# Convert the MCP server to a streamable HTTP application
# This creates a FastAPI app that implements the MCP protocol over HTTP
mcp_app = mcp_server.streamable_http_app()

# ============================================================================
# FastAPI Application Setup
# ============================================================================

# Create a separate FastAPI instance for additional API endpoints
# This allows you to add custom routes alongside the MCP endpoints
app = FastAPI(
    title="Custom MCP Server",
    description="Custom MCP Server for the app",
    version="0.1.0",
    lifespan=mcp_app.lifespan,  # Share the lifespan context with MCP app
)

# ============================================================================
# CORS Middleware Configuration
# ============================================================================

# Configure CORS to allow requests from common development origins
# This is essential for web-based clients to communicate with the server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Common React development port
        "http://127.0.0.1:3000",
        "http://localhost:5173",  # Common Vite development port
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,  # Allow cookies and authentication headers
    allow_methods=["*"],  # Allow all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],  # Allow all headers
)

if os.path.exists("client/build"):
    app.mount("/", StaticFiles(directory="client/build", html=True), name="static")

# Create the final application by combining MCP routes with custom API routes
# This is the application that uvicorn will serve
combined_app = FastAPI(
    title="Combined MCP App",
    routes=[
        *mcp_app.routes,  # MCP protocol routes (tools, resources, etc.)
        *app.routes,  # Your custom API routes (if any)
    ],
    lifespan=mcp_app.lifespan,  # Use MCP's lifespan for proper startup/shutdown
)

# Export the combined_app for uvicorn to import
# Usage: uvicorn server.app:combined_app


# Adds middleware to capture the user token from the request headers
@combined_app.middleware("http")
async def capture_headers(request: Request, call_next):
    """Middleware to capture request headers for authentication"""
    header_store.set(dict(request.headers))
    return await call_next(request)
