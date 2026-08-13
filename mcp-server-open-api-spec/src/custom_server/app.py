#!/usr/bin/env python3

"""Main FastAPI application with MCP server for API interactions"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastmcp import FastMCP

from .tools import load_tools
from .tracing import TraceContextMiddleware, configure_mlflow_tracing
from .utils import app_setup_complete, header_store

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Static directory for serving files
STATIC_DIR = Path(__file__).parent / "static"

# Create MCP server
mcp_server = FastMCP("Custom Open API Spec MCP Server")

# Load MCP tools
load_tools(mcp_server)

# Stateless mode keeps each tool body inside the current HTTP request's W3C context.
mcp_app = mcp_server.http_app(stateless_http=True)


@asynccontextmanager
async def lifespan(application):
    """Validate tracing resources before accepting MCP traffic."""
    configure_mlflow_tracing()
    async with mcp_app.lifespan(application):
        yield


# Create FastAPI app
app = FastAPI(
    title="Open API Spec MCP Server",
    description="MCP server for interacting with APIs using OpenAPI specifications",
    lifespan=lifespan,
)


@app.get("/", include_in_schema=False)
async def serve_index():
    """Serve the index page"""
    if app_setup_complete():
        if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
            return FileResponse(STATIC_DIR / "index.html")
        else:
            return {"message": "Custom Open API Spec MCP Server is running", "status": "healthy"}
    else:
        if STATIC_DIR.exists() and (STATIC_DIR / "setup_required.html").exists():
            return FileResponse(STATIC_DIR / "setup_required.html")
        else:
            return {
                "message": "Custom Open API Spec MCP Server is setup incorrectly. Please follow the readme at https://github.com/databricks/app-templates/blob/main/mcp-server-open-api-spec/README.md to setup your MCP Server correctly.",
                "status": "Not Healthy",
            }


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
    lifespan=lifespan,  # Use MCP's lifespan for proper startup/shutdown
)

combined_app.add_middleware(
    TraceContextMiddleware,
    server_name="custom-open-api-spec-server",
)


@combined_app.middleware("http")
async def capture_headers(request: Request, call_next):
    """Middleware to capture request headers for authentication"""
    header_store.set(dict(request.headers))
    return await call_next(request)
