import logging
import os
from datetime import datetime
from typing import AsyncGenerator

import litellm
import mlflow
from agents import Agent, Runner, function_tool, set_default_openai_api, set_default_openai_client
from agents.tracing import set_trace_processors
from databricks.sdk import WorkspaceClient
from databricks_openai import AsyncDatabricksOpenAI
from databricks_openai.agents import AsyncDatabricksSession, McpServer
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)
from agent_server.utils import (
    deduplicate_input,
    get_databricks_host_from_env,
    get_session_id,
    get_user_workspace_client,
    process_agent_stream_events,
    resolve_lakebase_instance_name,
)

# Lakebase configuration for persistent session storage
_LAKEBASE_INSTANCE_NAME_RAW = os.environ.get("LAKEBASE_INSTANCE_NAME") or None
LAKEBASE_AUTOSCALING_PROJECT = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
LAKEBASE_AUTOSCALING_BRANCH = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None

_has_autoscaling = LAKEBASE_AUTOSCALING_PROJECT and LAKEBASE_AUTOSCALING_BRANCH
if not _LAKEBASE_INSTANCE_NAME_RAW and not _has_autoscaling:
    raise ValueError(
        "Lakebase configuration is required but not set. "
        "Please set one of the following in your environment:\n"
        "  Option 1 (provisioned): LAKEBASE_INSTANCE_NAME=<your-instance-name>\n"
        "  Option 2 (autoscaling): LAKEBASE_AUTOSCALING_PROJECT=<project> and LAKEBASE_AUTOSCALING_BRANCH=<branch>\n"
    )
# Resolve hostname to instance name if needed (if given hostname of lakebase instead of name)
LAKEBASE_INSTANCE_NAME = resolve_lakebase_instance_name(_LAKEBASE_INSTANCE_NAME_RAW) if _LAKEBASE_INSTANCE_NAME_RAW else None


# NOTE: this will work for all databricks models OTHER than GPT-OSS, which uses a slightly different API
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
set_trace_processors([])  # only use mlflow for trace processing
mlflow.openai.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)
litellm.suppress_debug_info = True


@function_tool
def get_current_time() -> str:
    """Get the current date and time."""
    return datetime.now().isoformat()


async def init_mcp_server(workspace_client: WorkspaceClient):
    return McpServer(
        url=f"{get_databricks_host_from_env()}/api/2.0/mcp/functions/system/ai",
        name="system.ai uc function mcp server",
        workspace_client=workspace_client,
    )


def create_agent(mcp_servers: list[McpServer] | None = None) -> Agent:
    return Agent(
        name="Agent",
        instructions="You are a helpful assistant.",
        model="databricks-gpt-5-2",
        tools=[get_current_time],
        mcp_servers=mcp_servers or [],
    )


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    # Create session for stateful, short-term conversation history with your Databricks Lakebase instance
    session_id = get_session_id(request)
    if session_id:
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    session = AsyncDatabricksSession(
        session_id=session_id,
        instance_name=LAKEBASE_INSTANCE_NAME,
        project=LAKEBASE_AUTOSCALING_PROJECT,
        branch=LAKEBASE_AUTOSCALING_BRANCH,
    )

    # To use MCP server tools, wrap the code below with this async context manager.
    # By default, uses service principal credentials via WorkspaceClient().
    # For on-behalf-of user authentication, use get_user_workspace_client() instead.
    # try:
    #     async with await init_mcp_server(WorkspaceClient()) as mcp_server:
    #         agent = create_agent(mcp_servers=[mcp_server])
    # except Exception:
    #     logger.warning("MCP server unavailable. Continuing without MCP tools.", exc_info=True)
    #     agent = create_agent()
    agent = create_agent()
    messages = await deduplicate_input(request, session)
    result = await Runner.run(agent, messages, session=session)
    return ResponsesAgentResponse(
        output=[item.to_input_item() for item in result.new_items],
        custom_outputs={"session_id": session.session_id},
    )


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # Create session for stateful, short-term conversation history with your Databricks Lakebase instance
    session_id = get_session_id(request)
    if session_id:
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    session = AsyncDatabricksSession(
        session_id=session_id,
        instance_name=LAKEBASE_INSTANCE_NAME,
        project=LAKEBASE_AUTOSCALING_PROJECT,
        branch=LAKEBASE_AUTOSCALING_BRANCH,
    )

    # To use MCP server tools, wrap the code below with this async context manager.
    # By default, uses service principal credentials via WorkspaceClient().
    # For on-behalf-of user authentication, use get_user_workspace_client() instead.
    # try:
    #     async with await init_mcp_server(WorkspaceClient()) as mcp_server:
    #         agent = create_agent(mcp_servers=[mcp_server])
    # except Exception:
    #     logger.warning("MCP server unavailable. Continuing without MCP tools.", exc_info=True)
    #     agent = create_agent()
    agent = create_agent()
    messages = await deduplicate_input(request, session)
    result = Runner.run_streamed(agent, input=messages, session=session)

    async for event in process_agent_stream_events(result.stream_events()):
        yield event
