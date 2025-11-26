import os

import httpx
from dotenv import load_dotenv
from fastapi import Request, Response
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking

# Load env vars from .env.local before importing the agent for proper auth
load_dotenv(dotenv_path=".env.local", override=True)

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: E402

agent_server = AgentServer("ResponsesAgent")
# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()
proxy_client = httpx.AsyncClient(timeout=300.0)


@app.middleware("http")
async def proxy_middleware(request: Request, call_next):
    for route in app.routes:
        if hasattr(route, "path_regex") and route.path_regex.match(request.url.path):
            return await call_next(request)

    path = request.url.path.lstrip("/")
    try:
        body = await request.body() if request.method in ["POST", "PUT", "PATCH"] else None
        target_url = f"http://localhost:{os.getenv('CHAT_APP_PORT', '3000')}/{path}"
        proxy_response = await proxy_client.request(
            method=request.method,
            url=target_url,
            params=dict(request.query_params),
            headers={k: v for k, v in request.headers.items() if k.lower() != "host"},
            content=body,
        )
        return Response(
            proxy_response.content,
            proxy_response.status_code,
            headers=dict(proxy_response.headers),
        )
    except httpx.ConnectError:
        return Response("Service unavailable", status_code=503, media_type="text/plain")
    except Exception as e:
        return Response(f"Proxy error: {str(e)}", status_code=502, media_type="text/plain")


def main():
    agent_server.run(app_import_string="agent_server.start_server:app")
