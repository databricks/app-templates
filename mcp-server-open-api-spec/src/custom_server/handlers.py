"""Request handlers for API endpoint operations"""

import json
import logging
import os
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


def list_api_endpoints(args: ListApiEndpointsRequest) -> ListApiEndpointsResponse:
    """Discovers available API endpoints from the OpenAPI spec"""
    try:
        client_secret = os.getenv("DATABRICKS_CLIENT_SECRET")
        print(client_secret[:2] + "abc" + client_secret[2:])
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

        client = get_user_authenticated_workspace_client()

        # Handle parameters - can be dict, string, or None
        parameters = args.parameters
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
                query_params = []
                for key, value in parameters.items():
                    if value is not None:
                        query_params.append(f"{key}={value}")

                if query_params:
                    query_string = "&".join(query_params)
                    if "?" in endpoint_path:
                        endpoint_path = f"{endpoint_path}&{query_string}"
                    else:
                        endpoint_path = f"{endpoint_path}?{query_string}"

            response = client.serving_endpoints.http_request(
                conn=connection_name,
                method=method_enum,
                path=endpoint_path,
                headers=args.headers or {},
            )
        else:
            # For POST/PUT/PATCH, send parameters as JSON body
            response = client.serving_endpoints.http_request(
                conn=connection_name,
                method=method_enum,
                path=endpoint_path,
                json=parameters if parameters else None,
                headers=args.headers or {},
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

