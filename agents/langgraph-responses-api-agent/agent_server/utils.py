from typing import Any, AsyncGenerator, AsyncIterator, Optional

from databricks.sdk import WorkspaceClient
from httpx import AsyncClient, Auth, Request
from langchain.messages import AIMessageChunk
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import (
    ResponsesAgentStreamEvent,
    create_text_delta,
    output_to_responses_items_stream,
)
from openai import AsyncOpenAI


def get_user_workspace_client() -> WorkspaceClient:
    token = get_request_headers().get("x-forwarded-access-token")
    return WorkspaceClient(token=token, auth_type="pat")


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


async def process_agent_astream_events(
    async_stream: AsyncIterator[Any],
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    """
    Generic helper to process agent stream events and yield ResponsesAgentStreamEvent objects.

    Args:
        async_stream: The async iterator from agent.astream()
    """
    async for event in async_stream:
        if event[0] == "updates":
            for node_data in event[1].values():
                if len(node_data.get("messages", [])) > 0:
                    for item in output_to_responses_items_stream(node_data["messages"]):
                        yield item
        elif event[0] == "messages":
            try:
                chunk = event[1][0]
                if isinstance(chunk, AIMessageChunk) and (content := chunk.content):
                    yield ResponsesAgentStreamEvent(
                        **create_text_delta(delta=content, item_id=chunk.id)
                    )
            except Exception as e:
                print(e)
