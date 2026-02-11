import os
from typing import AsyncGenerator

from uuid_utils import uuid7

import mlflow
from agents import Agent, Runner, set_default_openai_api, set_default_openai_client
from agents.tracing import set_trace_processors
from databricks_openai import AsyncDatabricksOpenAI
from databricks_openai.agents import AsyncDatabricksSession, McpServer
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import (
    get_databricks_host_from_env,
    get_user_workspace_client,
    process_agent_stream_events,
    resolve_lakebase_instance_name,
)

# Lakebase instance name for persistent session storage
_LAKEBASE_INSTANCE_NAME_RAW = os.environ.get("LAKEBASE_INSTANCE_NAME")
if not _LAKEBASE_INSTANCE_NAME_RAW:
    raise ValueError(
        "LAKEBASE_INSTANCE_NAME environment variable is required but not set. "
        "Please set it in your environment:\n"
        "  LAKEBASE_INSTANCE_NAME=<your-lakebase-instance-name>\n"
    )
# Resolve hostname to instance name if needed (if given hostname of lakebase instead of name)
LAKEBASE_INSTANCE_NAME = resolve_lakebase_instance_name(_LAKEBASE_INSTANCE_NAME_RAW)


def get_session_id(request: ResponsesAgentRequest) -> str:
    """Extract session_id from request or generate a new one."""
    # Try to get session_id from custom_inputs if provided
    if hasattr(request, "custom_inputs") and request.custom_inputs:
        if "session_id" in request.custom_inputs:
            return request.custom_inputs["session_id"]
    # Fall back to generating a new session_id
    return str(uuid7())

# NOTE: this will work for all databricks models OTHER than GPT-OSS, which uses a slightly different API
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
set_trace_processors([])  # only use mlflow for trace processing
mlflow.openai.autolog()


async def init_mcp_server():
    return McpServer(
        url=f"{get_databricks_host_from_env()}/api/2.0/mcp/functions/system/ai",
        name="system.ai uc function mcp server",
    )


def create_coding_agent(mcp_server: McpServer) -> Agent:
    return Agent(
        name="code execution agent",
        instructions="You are a code execution agent. You can execute code and return the results.",
        model="databricks-gpt-5-2",
        mcp_servers=[mcp_server],
    )


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()

    # Create session for persistent conversation history with your Databricks Lakebase instance
    session = AsyncDatabricksSession(
        session_id=get_session_id(request),
        instance_name=LAKEBASE_INSTANCE_NAME,
    )

    async with await init_mcp_server() as mcp_server:
        agent = create_coding_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = await Runner.run(agent, messages, session=session)
        return ResponsesAgentResponse(
            output=[item.to_input_item() for item in result.new_items],
            custom_outputs={"session_id": session.session_id},
        )


@stream()
async def stream_handler(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()

    # Create session for persistent conversation history with your Databricks Lakebase instance
    session = AsyncDatabricksSession(
        session_id=get_session_id(request),
        instance_name=LAKEBASE_INSTANCE_NAME,
    )

    async with await init_mcp_server() as mcp_server:
        agent = create_coding_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = Runner.run_streamed(agent, input=messages, session=session)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
