import logging
import re
from typing import AsyncGenerator

import mlflow
from databricks.sdk import WorkspaceClient
from databricks_openai import DatabricksOpenAI
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import get_session_id

mlflow.openai.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)

# Model name controls which AI provider runs the agent loop.
# Swap to any Databricks-hosted model without changing your tool or agent code.
MODEL = "databricks-claude-opus-4-6"

# Hosted tools — the Supervisor API runs the tool-selection and synthesis loop
# server-side. Add or remove tool definitions here to change agent behavior.
TOOLS = [
    {
        "type": "genie",
        "genie": {
            "name": "nyc-taxi-space",
            "description": "Information about NYC Taxi spaces",
            "space_id": "01f07892cf3118edad0a4054bcd25122",
        },
    }
]


def _ai_gateway_base_url(wc: WorkspaceClient) -> str:
    """Derive the AI Gateway base URL from the workspace host and workspace ID.

    The Supervisor API is served by AI Gateway at a dedicated subdomain:
      https://<workspace_id>.ai-gateway.<domain>/mlflow/v1

    This is distinct from the workspace host (used for /serving-endpoints).
    """
    host = wc.config.host  # e.g. https://my-workspace.cloud.databricks.com
    workspace_id = wc.get_workspace_id()
    # Strip the first subdomain and replace with <workspace_id>.ai-gateway
    domain = re.match(r"https://[^.]+\.(.+)", host).group(1)
    return f"https://{workspace_id}.ai-gateway.{domain}/mlflow/v1"


_EXTRA_HEADERS = {"x-databricks-traffic-id": "testenv://liteswap/mas-arv"}


def _get_client() -> DatabricksOpenAI:
    wc = WorkspaceClient()
    return DatabricksOpenAI(
        workspace_client=wc,
        base_url=_ai_gateway_base_url(wc),
    )


@invoke()
def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    response = _get_client().responses.create(
        model=MODEL,
        input=[i.model_dump() for i in request.input],
        tools=TOOLS,
        stream=False,
        extra_headers=_EXTRA_HEADERS,
    )
    return ResponsesAgentResponse(output=[item.model_dump() for item in response.output])


@stream()
def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    return _get_client().responses.create(
        model=MODEL,
        input=[i.model_dump() for i in request.input],
        tools=TOOLS,
        stream=True,
        extra_headers=_EXTRA_HEADERS,
    )
