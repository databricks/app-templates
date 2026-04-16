import logging
from datetime import datetime
from typing import AsyncGenerator

import mlflow
from agents import Agent, Runner, function_tool, set_default_openai_api, set_default_openai_client
from agents.tracing import set_trace_processors
from databricks.sdk import WorkspaceClient
from databricks_openai import AsyncDatabricksOpenAI
from databricks_openai.agents import AsyncDatabricksSession, McpServer
from fastapi import HTTPException
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import (
    deduplicate_input,
    get_databricks_host_from_env,
    get_lakebase_access_error_message,
    get_session_id,
    get_user_workspace_client,
    lakebase_config,
    process_agent_stream_events,
)


# NOTE: this will work for all databricks models OTHER than GPT-OSS, which uses a slightly different API
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
set_trace_processors([])  # only use mlflow for trace processing
mlflow.openai.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)


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
    try:
        # Create session for stateful, short-term conversation history with your Databricks Lakebase instance
        session_id = get_session_id(request)
        if session_id:
            mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
        session = AsyncDatabricksSession(
            session_id=session_id,
            instance_name=lakebase_config.instance_name,
            autoscaling_endpoint=lakebase_config.autoscaling_endpoint,
            project=lakebase_config.autoscaling_project,
            branch=lakebase_config.autoscaling_branch,
            schema=lakebase_config.memory_schema,
            create_tables=False,  # Tables created at startup in start_server.py
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
    except Exception as e:
        error_msg = str(e).lower()
        if any(
            keyword in error_msg
            for keyword in ["lakebase", "pg_hba", "postgres", "database instance", "insufficient privilege"]
        ):
            logger.error("Lakebase access error: %s", e)
            raise HTTPException(
                status_code=503,
                detail=get_lakebase_access_error_message(lakebase_config.description),
            ) from e
        raise


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    try:
        # Create session for stateful, short-term conversation history with your Databricks Lakebase instance
        session_id = get_session_id(request)
        if session_id:
            mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
        session = AsyncDatabricksSession(
            session_id=session_id,
            instance_name=lakebase_config.instance_name,
            autoscaling_endpoint=lakebase_config.autoscaling_endpoint,
            project=lakebase_config.autoscaling_project,
            branch=lakebase_config.autoscaling_branch,
            schema=lakebase_config.memory_schema,
            create_tables=False,  # Tables created at startup in start_server.py
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
    except Exception as e:
        error_msg = str(e).lower()
        if any(
            keyword in error_msg
            for keyword in ["lakebase", "pg_hba", "postgres", "database instance", "insufficient privilege"]
        ):
            logger.error("Lakebase access error: %s", e)
            raise HTTPException(
                status_code=503,
                detail=get_lakebase_access_error_message(lakebase_config.description),
            ) from e
        raise
