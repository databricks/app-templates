import logging
from datetime import datetime
from typing import AsyncGenerator, Optional
from uuid import uuid4

from databricks.sdk import WorkspaceClient
from databricks_langchain import ChatDatabricks, DatabricksMCPServer, DatabricksMultiServerMCPClient
from langchain.agents import create_agent
from langchain_core.tools import tool
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    to_chat_completions_input,
)

from agent_server.utils import (
    get_databricks_host_from_env,
    get_mcp_tools,
    get_session_id,
    get_user_workspace_client,
    process_agent_astream_events,
)
from agent_server.tracing import (
    LangChainUsageCallback,
    agent_request_span,
    configure_mlflow_tracing,
    set_request_trace_identity,
    traced_operation,
)
from mlflow.entities import SpanType

logger = logging.getLogger(__name__)
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)


@tool
def get_current_time() -> str:
    """Get the current date and time."""
    return datetime.now().isoformat()


def init_mcp_client(workspace_client: WorkspaceClient) -> DatabricksMultiServerMCPClient:
    with traced_operation(
        "mcp.initialize", SpanType.TOOL, {"servers": [{"name": "system-ai"}]}
    ) as operation:
        host_name = get_databricks_host_from_env()
        url = f"{host_name}/api/2.0/mcp/functions/system/ai"
        client = DatabricksMultiServerMCPClient(
            [
                DatabricksMCPServer(
                    name="system-ai",
                    url=url,
                    workspace_client=workspace_client,
                ),
            ]
        )
        operation.set_outputs(
            {"initialized": True, "server_count": 1, "servers": [{"url": url}]}
        )
        return client


async def init_agent(workspace_client: Optional[WorkspaceClient] = None):
    configure_mlflow_tracing()
    tools = [get_current_time]
    # To use MCP server tools instead, replace the line above with:
    #   mcp_client = init_mcp_client(workspace_client or WorkspaceClient())
    #   try:
    #       tools.extend(await get_mcp_tools(mcp_client))
    #   except Exception:
    #       logger.warning("Failed to fetch MCP tools. Continuing without MCP tools.", exc_info=True)
    return create_agent(tools=tools, model=ChatDatabricks(endpoint="databricks-gpt-5-2"))


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    outputs = [
        event.item
        async for event in stream_handler(request)
        if event.type == "response.output_item.done"
    ]
    return ResponsesAgentResponse(output=outputs)


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    configure_mlflow_tracing()
    custom_inputs = dict(request.custom_inputs or {})
    session_id = get_session_id(request) or str(uuid4())
    user_id = (
        request.user
        or custom_inputs.get("user_id")
        or (getattr(request.context, "user_id", None) if request.context else None)
        or "anonymous"
    )
    request_id = (
        custom_inputs.get("request_id")
        or (request.metadata or {}).get("request_id")
        or str(uuid4())
    )

    with agent_request_span("langgraph.request", request.model_dump()) as request_trace:
        set_request_trace_identity(
            session_id=str(session_id),
            user_id=str(user_id),
            request_id=str(request_id),
            template_name="agent-langgraph",
        )
        # By default, uses service principal credentials.
        # For on-behalf-of user authentication, use get_user_workspace_client() instead.
        agent = await init_agent()
        messages = {
            "messages": to_chat_completions_input([i.model_dump() for i in request.input])
        }
        callback = LangChainUsageCallback(request_trace)
        outputs: list[dict] = []
        async for event in process_agent_astream_events(
            agent.astream(
                input=messages,
                config={"callbacks": [callback]},
                stream_mode=["updates", "messages"],
            )
        ):
            outputs.append(event.model_dump(exclude_none=True))
            yield event
        request_trace.set_outputs({"events": outputs})
