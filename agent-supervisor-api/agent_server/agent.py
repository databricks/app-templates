import logging
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
MODEL = "databricks-claude-sonnet-4-5"

# Hosted tools — the Supervisor API runs the tool-selection and synthesis loop
# server-side. Add or remove tool definitions here to change agent behavior.
TOOLS = [
    {
        "type": "uc_function",
        "uc_function": {
            "name": "system.ai.python_exec",
            "name_alias": "python_exec",
            "description": "Execute Python code to perform calculations, data analysis, or string processing.",
        },
    }
]


def _get_client() -> DatabricksOpenAI:
    # The Supervisor API is served at /mlflow/v1/responses on the AI Gateway,
    # not at /serving-endpoints (the default for DatabricksOpenAI). Pass the
    # base_url explicitly so responses.create() hits the right endpoint.
    wc = WorkspaceClient()
    return DatabricksOpenAI(
        workspace_client=wc,
        base_url=f"{wc.config.host}/mlflow/v1",
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
    )
    return ResponsesAgentResponse(output=response.output)


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
    )
