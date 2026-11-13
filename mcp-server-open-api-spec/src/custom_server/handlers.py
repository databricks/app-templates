"""Request handlers for API endpoint operations"""

import json
import logging
import os
import re
from urllib.parse import urlencode

from databricks.sdk.service.serving import ExternalFunctionRequestHttpMethod

from .schemas import (
    EndpointMetadata,
    GetApiEndpointSchemaRequest,
    GetApiEndpointSchemaResponse,
    InvokeApiEndpointRequest,
    InvokeApiEndpointResponse,
    ListApiEndpointsRequest,
    ListApiEndpointsResponse,
)
from .utils import get_user_authenticated_workspace_client, load_openapi_spec

logger = logging.getLogger(__name__)

# endpoint_path, parameters and headers for invoke_api_endpoint come from the LLM,
# so they are constrained to what the OpenAPI spec defines before any request is sent
# through the UC connection.
MAX_PATH_LENGTH = 2048
MAX_PARAMETERS_LENGTH = 100_000
MAX_HEADERS = 20
MAX_HEADER_VALUE_LENGTH = 1024
ALLOWED_FORWARD_HEADERS = {
    "accept",
    "accept-language",
    "content-type",
    "if-match",
    "if-none-match",
    "if-modified-since",
    "prefer",
}
_ENCODED_SEPARATORS = re.compile(r"%(2e|2f|5c|40|00)", re.IGNORECASE)
_PATH_PARAM = re.compile(r"\{[^/{}]+\}")


def _path_template_pattern(template: str) -> re.Pattern:
    """Regex for an OpenAPI path template; each {param} matches one path segment."""
    parts = _PATH_PARAM.split(template)
    return re.compile("^" + "[^/]+".join(re.escape(part) for part in parts) + "$")


def _validate_endpoint_path(endpoint_path: str, http_method: str) -> None:
    """Allow only relative paths that match a path template and method in the spec."""
    if len(endpoint_path) > MAX_PATH_LENGTH:
        raise ValueError(f"endpoint_path is longer than {MAX_PATH_LENGTH} characters")
    if "?" in endpoint_path or "#" in endpoint_path:
        raise ValueError(
            "endpoint_path must not contain a query string; pass query values in parameters"
        )
    if (
        not endpoint_path.startswith("/")
        or endpoint_path.startswith("//")
        or "://" in endpoint_path
        or "\\" in endpoint_path
        or "@" in endpoint_path
        or ".." in endpoint_path
        or "." in endpoint_path.split("/")
        or _ENCODED_SEPARATORS.search(endpoint_path)
        or any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F for ch in endpoint_path)
    ):
        raise ValueError(f"endpoint_path {endpoint_path!r} is not a valid relative API path")

    paths = load_openapi_spec().get("paths", {})
    matches = [
        path_item
        for template, path_item in paths.items()
        if isinstance(path_item, dict) and _path_template_pattern(template).match(endpoint_path)
    ]
    if not matches:
        raise ValueError(
            f"endpoint_path {endpoint_path!r} does not match any path in the API specification"
        )
    if not any(http_method.lower() in path_item for path_item in matches):
        raise ValueError(
            f"Method {http_method} is not defined for {endpoint_path!r} in the API specification"
        )


def _validate_headers(headers: dict) -> dict:
    """Forward only allowlisted headers; auth and routing headers come from the UC connection."""
    if len(headers) > MAX_HEADERS:
        raise ValueError(f"At most {MAX_HEADERS} headers can be sent")
    for name, value in headers.items():
        if name.lower() not in ALLOWED_FORWARD_HEADERS:
            allowed = ", ".join(sorted(ALLOWED_FORWARD_HEADERS))
            raise ValueError(f"Header {name!r} is not allowed; allowed headers: {allowed}")
        if len(value) > MAX_HEADER_VALUE_LENGTH or "\r" in value or "\n" in value:
            raise ValueError(f"Header {name!r} has an invalid value")
    return headers


def list_api_endpoints(args: ListApiEndpointsRequest) -> ListApiEndpointsResponse:
    """Discovers available API endpoints from the OpenAPI spec"""
    try:
        spec = load_openapi_spec()
        paths = spec.get("paths", {})

        endpoints = []

        for path, path_item in paths.items():
            if not isinstance(path_item, dict):
                continue

            for method, operation in path_item.items():
                # Skip non-HTTP methods
                if method.upper() not in [
                    "GET",
                    "POST",
                    "PUT",
                    "DELETE",
                    "PATCH",
                    "HEAD",
                    "OPTIONS",
                ]:
                    continue

                if not isinstance(operation, dict):
                    continue

                summary = operation.get("summary", "")
                description = operation.get("description", "")
                operation_id = operation.get("operationId", "")
                tags = operation.get("tags", [])

                endpoint_metadata = EndpointMetadata(
                    path=path,
                    method=method.upper(),
                    summary=summary,
                    description=description,
                    operationId=operation_id,
                    tags=tags if isinstance(tags, list) else [],
                )

                # Apply search filter if provided
                if args.search_query:
                    query_lower = args.search_query.lower()
                    if (
                        query_lower in path.lower()
                        or query_lower in summary.lower()
                        or query_lower in description.lower()
                        or query_lower in operation_id.lower()
                        or any(query_lower in tag.lower() for tag in tags if isinstance(tag, str))
                    ):
                        endpoints.append(endpoint_metadata)
                else:
                    endpoints.append(endpoint_metadata)

        # Limit results to avoid overwhelming response
        endpoints = endpoints[:50]

        return ListApiEndpointsResponse(
            endpoints=endpoints,
            total=len(endpoints),
            message=f"Found {len(endpoints)} API endpoints"
            + (f" matching '{args.search_query}'" if args.search_query else ""),
        )

    except Exception as e:
        logger.error(f"Error listing API endpoints: {e}")
        raise


def get_api_endpoint_schema(args: GetApiEndpointSchemaRequest) -> GetApiEndpointSchemaResponse:
    """Gets detailed schema information for a specific API endpoint"""
    try:
        spec = load_openapi_spec()
        paths = spec.get("paths", {})

        if args.endpoint_path not in paths:
            raise ValueError(f"Endpoint {args.endpoint_path} not found in API specification")

        path_item = paths[args.endpoint_path]
        method_lower = args.http_method.lower()

        if method_lower not in path_item:
            raise ValueError(
                f"Method {args.http_method} not found for endpoint {args.endpoint_path}"
            )

        operation = path_item[method_lower]

        return GetApiEndpointSchemaResponse(
            endpoint_path=args.endpoint_path,
            http_method=args.http_method.upper(),
            operation=operation,
        )

    except Exception as e:
        logger.error(f"Error getting API endpoint schema: {e}")
        raise


def invoke_api_endpoint(args: InvokeApiEndpointRequest) -> InvokeApiEndpointResponse:
    """Executes an API endpoint"""
    try:
        # Convert HTTP method string to enum
        method_mapping = {
            "GET": ExternalFunctionRequestHttpMethod.GET,
            "POST": ExternalFunctionRequestHttpMethod.POST,
            "PUT": ExternalFunctionRequestHttpMethod.PUT,
            "DELETE": ExternalFunctionRequestHttpMethod.DELETE,
            "PATCH": ExternalFunctionRequestHttpMethod.PATCH,
        }

        method_enum = method_mapping.get(args.http_method.upper())
        if not method_enum:
            raise ValueError(f"Unsupported HTTP method: {args.http_method}")

        _validate_endpoint_path(args.endpoint_path, args.http_method)
        headers = _validate_headers(args.headers or {})

        # Handle parameters - can be dict, string, or None
        parameters = args.parameters
        size = len(parameters) if isinstance(parameters, str) else len(json.dumps(parameters))
        if size > MAX_PARAMETERS_LENGTH:
            raise ValueError(f"parameters are larger than {MAX_PARAMETERS_LENGTH} characters")

        client = get_user_authenticated_workspace_client()

        if isinstance(parameters, str):
            # If it's a string, try to parse as JSON
            try:
                parameters = json.loads(parameters)
            except json.JSONDecodeError:
                # If parsing fails, treat as raw string
                parameters = {"value": parameters}

        endpoint_path = args.endpoint_path
        connection_name = os.getenv("UC_CONNECTION_NAME")

        # Prepare the API call based on HTTP method
        if args.http_method.upper() in ["GET", "DELETE"]:
            # For GET/DELETE requests, add parameters as query params
            if parameters and isinstance(parameters, dict):
                query_string = urlencode(
                    {key: value for key, value in parameters.items() if value is not None},
                    doseq=True,
                )
                if query_string:
                    endpoint_path = f"{endpoint_path}?{query_string}"

            response = client.serving_endpoints.http_request(
                conn=connection_name,
                method=method_enum,
                path=endpoint_path,
                headers=headers,
            )
        else:
            # For POST/PUT/PATCH, send parameters as JSON body
            response = client.serving_endpoints.http_request(
                conn=connection_name,
                method=method_enum,
                path=endpoint_path,
                json=parameters if parameters else None,
                headers=headers,
            )

        # Parse the response
        status_code = getattr(response, "status_code", 0)
        raw_headers = getattr(response, "headers", {})
        # Filter out None values from headers and convert to strings
        response_headers = {
            k: str(v) if v is not None else "" for k, v in dict(raw_headers).items()
        }
        response_text = getattr(response, "text", str(response))

        response_json = None
        try:
            if hasattr(response, "json") and callable(response.json):
                response_json = response.json()
            elif response_text:
                try:
                    response_json = json.loads(response_text)
                except json.JSONDecodeError:
                    pass
        except Exception:
            # JSON parsing failed, that's okay
            pass

        return InvokeApiEndpointResponse(
            ok=200 <= status_code < 400,
            status_code=status_code,
            headers=response_headers,
            text=response_text,
            response_json=response_json,
        )

    except Exception as e:
        logger.error(f"Error invoking API endpoint: {e}")
        raise
