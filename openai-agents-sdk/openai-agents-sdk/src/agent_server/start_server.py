import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import Request, Response
from fastapi.staticfiles import StaticFiles
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking

# Load environment variables from .env.local if it exists
load_dotenv(dotenv_path=".env.local", override=True)

# Need to import the agent to register the functions with the server
# Set the env vars before importing the agent for proper auth
import agent_server.agent  # noqa: E402

agent_server = AgentServer("ResponsesAgent")
# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()
proxy_client = httpx.AsyncClient(timeout=300.0)


async def proxy_to_localhost(request: Request, path: str):
    """
    Catch-all route that proxies requests to localhost:3000
    Only triggered for paths not already handled by MLflow routes
    """
    try:
        # Build the target URL
        target_url = f"http://localhost:3000/{path}"

        print("Proxying request to localhost:3000", target_url)

        # Prepare headers (exclude hop-by-hop headers)
        headers = dict(request.headers)
        headers_to_remove = ["host", "content-length", "connection", "upgrade"]
        for header in headers_to_remove:
            headers.pop(header, None)

        # Get query parameters
        query_params = str(request.query_params) if request.query_params else None
        if query_params:
            target_url += f"?{query_params}"

        # Get request body for non-GET requests
        body = None
        if request.method in ["POST", "PUT", "PATCH"]:
            body = await request.body()

        # Make the proxy request
        proxy_response = await proxy_client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body,
        )

        # Prepare response headers (exclude hop-by-hop headers)
        response_headers = dict(proxy_response.headers)
        response_headers_to_remove = ["content-length", "connection", "transfer-encoding"]
        for header in response_headers_to_remove:
            response_headers.pop(header, None)

        # Return the proxied response
        return Response(
            content=proxy_response.content,
            status_code=proxy_response.status_code,
            headers=response_headers,
            media_type=proxy_response.headers.get("content-type"),
        )

    except httpx.ConnectError:
        return Response(
            content="Service at localhost:3000 is not available",
            status_code=502,
            media_type="text/plain",
        )
    except httpx.TimeoutException:
        return Response(
            content="Request to localhost:3000 timed out",
            status_code=504,
            media_type="text/plain",
        )
    except Exception as e:
        return Response(
            content=f"Proxy error: {str(e)}",
            status_code=500,
            media_type="text/plain",
        )


# Register the catch-all proxy route
app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])(
    proxy_to_localhost
)


def main():
    # to support multiple workers, import the app defined above as a string
    agent_server.run(app_import_string="agent_server.start_server:app")


if __name__ == "__main__":
    main()
