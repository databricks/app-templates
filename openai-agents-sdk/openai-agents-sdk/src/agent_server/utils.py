from typing import Optional

from databricks.sdk import WorkspaceClient
from httpx import AsyncClient, Auth, Request
from mlflow.genai.agent_server import get_request_headers
from openai import AsyncOpenAI


def get_databricks_host_from_env() -> Optional[str]:
    try:
        w = WorkspaceClient()
        return w.config.host
    except Exception as e:
        print(e)
        return None


def _get_async_http_client(workspace_client: WorkspaceClient) -> AsyncClient:
    class BearerAuth(Auth):
        def __init__(self, get_headers_func):
            self.get_headers_func = get_headers_func

        def auth_flow(self, request: Request) -> Request:
            auth_headers = self.get_headers_func()
            request.headers["Authorization"] = auth_headers["Authorization"]
            yield request

    databricks_token_auth = BearerAuth(workspace_client.config.authenticate)
    return AsyncClient(auth=databricks_token_auth)


def get_async_openai_client(workspace_client: WorkspaceClient) -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url=f"{get_databricks_host_from_env()}/serving-endpoints",
        api_key="no-token",  # Passing in a placeholder to pass validations, this will not be used
        http_client=_get_async_http_client(workspace_client),
    )


def get_user_workspace_client() -> WorkspaceClient:
    token = get_request_headers().get("x-forwarded-access-token")
    return WorkspaceClient(token=token, auth_type="pat")
