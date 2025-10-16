#!/usr/bin/env python3

"""Main FastAPI application with MCP server for API interactions"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional, Union

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from mcp.server.fastmcp import FastMCP

from .handlers import (
    get_api_endpoint_schema as get_schema_handler,
)
from .handlers import (
    invoke_api_endpoint as invoke_endpoint_handler,
)
from .handlers import (
    list_api_endpoints as list_endpoints_handler,
)
from .schemas import (
    GetApiEndpointSchemaRequest,
    InvokeApiEndpointRequest,
    ListApiEndpointsRequest,
)
from .utils import header_store

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Static directory for serving files
STATIC_DIR = Path(__file__).parent / "static"

# Create MCP server
mcp = FastMCP("Custom Open API Spec MCP Server")


# Register MCP tools
@mcp.tool()
def list_api_endpoints(search_query: Optional[str] = None) -> Dict[str, Any]:
    """
    Discovers available API endpoints, with optional filtering by search query

    Args:
        search_query: Optional search query to filter endpoints by path, method, or description

    Returns:
        Dictionary containing the list of endpoints
    """
    args = ListApiEndpointsRequest(search_query=search_query)
    result = list_endpoints_handler(args)
    return result.model_dump()


@mcp.tool()
def get_api_endpoint_schema(endpoint_path: str, http_method: str) -> Dict[str, Any]:
    """
    Gets detailed schema information for a specific API endpoint

    Args:
        endpoint_path: The API endpoint path (e.g., '/api/2.0/clusters/list')
        http_method: HTTP method (GET, POST, PUT, DELETE, etc.)

    Returns:
        Dictionary containing the endpoint schema
    """
    args = GetApiEndpointSchemaRequest(endpoint_path=endpoint_path, http_method=http_method)
    result = get_schema_handler(args)
    return result.model_dump()


@mcp.tool()
def invoke_api_endpoint(
    endpoint_path: str,
    http_method: str,
    parameters: Optional[Union[Dict[str, Any], str]] = None,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Executes an API endpoint with the appropriate parameters

    Args:
        endpoint_path: The API endpoint path to invoke
        http_method: HTTP method for the request
        parameters: Request parameters (for GET/DELETE: query params, for POST/PUT/PATCH: JSON body)
        headers: Additional HTTP headers as key-value pairs

    Returns:
        Dictionary containing the API response
    """
    logger.info(f"Invoking {http_method} {endpoint_path}")

    try:
        args = InvokeApiEndpointRequest(
            endpoint_path=endpoint_path,
            http_method=http_method,
            parameters=parameters,
            headers=headers,
        )
        result = invoke_endpoint_handler(args)

        # Handle JSON serialization - ensure everything is JSON-safe
        json_content = result.response_json
        if json_content is not None:
            try:
                # Test JSON serialization to catch any non-serializable objects
                json.dumps(json_content)
            except (TypeError, ValueError) as e:
                logger.warning(f"JSON response not serializable: {e}")
                # If JSON serialization fails, convert to string
                json_content = {"error": "Non-serializable response", "details": str(e)}

        # Return clean API response
        response_data = {
            "ok": bool(result.ok),
            "status_code": int(result.status_code),
            "headers": {str(k): str(v) for k, v in result.headers.items()},
            "text": result.text,
            "json": json_content,
        }

        logger.info(f"Returning API response: status={result.status_code}")
        return response_data

    except Exception as e:
        logger.error(f"API call failed: {e}")
        return {
            "ok": False,
            "status_code": 500,
            "headers": {},
            "text": None,
            "json": None,
            "error": str(e),
        }


# Create the MCP app
mcp_app = mcp.streamable_http_app()

# Create FastAPI app
app = FastAPI(
    title="Open API Spec MCP Server",
    description="MCP server for interacting with APIs using OpenAPI specifications",
    lifespan=lambda _: mcp.session_manager.run(),
)


@app.middleware("http")
async def capture_headers(request: Request, call_next):
    """Middleware to capture request headers for authentication"""
    header_store.set(dict(request.headers))
    return await call_next(request)


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


# Mount the MCP app
app.mount("/", mcp_app)
