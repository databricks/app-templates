#!/usr/bin/env python3

"""Main FastAPI application with MCP server for API interactions"""

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastmcp import FastMCP
from fastapi.middleware.cors import CORSMiddleware

from .tools import load_tools
from .utils import header_store

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Static directory for serving files
STATIC_DIR = Path(__file__).parent / "static"

# Create MCP server
mcp_server = FastMCP("Custom Open API Spec MCP Server")

# Load MCP tools
load_tools(mcp_server)

# Create the MCP app
mcp_app = mcp_server.streamable_http_app()

# Create FastAPI app
app = FastAPI(
    title="Open API Spec MCP Server",
    description="MCP server for interacting with APIs using OpenAPI specifications",
    lifespan=mcp_app.lifespan
)


@app.get("/", include_in_schema=False)
async def serve_index():
    """Serve the index page"""
    if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
        return FileResponse(STATIC_DIR / "index.html")
    else:
        return {"message": "Custom Open API Spec MCP Server is running", "status": "healthy"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "Custom Open API Spec MCP Server"}

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

@combined_app.middleware("http")
async def capture_headers(request: Request, call_next):
    """Middleware to capture request headers for authentication"""
    header_store.set(dict(request.headers))
    return await call_next(request)
