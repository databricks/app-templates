"""Pydantic schemas for API endpoint request/response validation"""

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


class EndpointMetadata(BaseModel):
    path: str
    method: str
    summary: str = ""
    description: str = ""
    operationId: str = ""
    tags: List[str] = []


class ListApiEndpointsRequest(BaseModel):
    search_query: Optional[str] = Field(
        default=None,
        description="Optional search query to filter by path, method, summary, description, or operationId",
    )


class ListApiEndpointsResponse(BaseModel):
    endpoints: List[EndpointMetadata]
    total: int
    message: str


class GetApiEndpointSchemaRequest(BaseModel):
    endpoint_path: str = Field(..., description="e.g. /api/1.2/commands/execute")
    http_method: str = Field(..., description="GET, POST, PUT, DELETE, PATCH, ...")


class GetApiEndpointSchemaResponse(BaseModel):
    endpoint_path: str
    http_method: str
    operation: Dict[str, Any]


class InvokeApiEndpointRequest(BaseModel):
    endpoint_path: str
    http_method: str
    parameters: Optional[Union[Dict[str, Any], str]] = Field(
        default=None,
        description=(
            "For GET/DELETE: query params as object. "
            "For POST/PUT/PATCH: JSON body as object, or raw JSON string."
        ),
    )
    headers: Optional[Dict[str, str]] = Field(default=None, description="Additional HTTP headers")


class InvokeApiEndpointResponse(BaseModel):
    ok: bool
    status_code: int
    headers: Dict[str, str] = {}
    text: Optional[str] = None
    response_json: Optional[Any] = Field(default=None, alias="json")
