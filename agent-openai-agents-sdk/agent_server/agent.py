import logging
from contextlib import AsyncExitStack
from datetime import datetime
from typing import AsyncGenerator

import mlflow
from agents import Agent, Runner, function_tool, set_default_openai_api, set_default_openai_client
from agents.tracing import set_trace_processors
from databricks.sdk import WorkspaceClient
from databricks_openai import AsyncDatabricksOpenAI
from databricks_openai.agents import McpServer
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import (
    build_mcp_url,
    get_session_id,
    get_user_workspace_client,
    process_agent_stream_events,
)

logger = logging.getLogger(__name__)

# NOTE: this will work for all databricks models OTHER than GPT-OSS, which uses a slightly different API
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
set_trace_processors([])  # only use mlflow for trace processing
mlflow.openai.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)


@function_tool
def get_current_time() -> str:
    """Get the current date and time."""
    return datetime.now().isoformat()


async def init_mcp_server(workspace_client: WorkspaceClient):
    return McpServer(
        url=build_mcp_url("/api/2.0/mcp/functions/system/ai", workspace_client=workspace_client),
        name="system.ai UC function MCP server",
        workspace_client=workspace_client,
    )


async def connect_healthy_mcp_servers(
    stack: AsyncExitStack, servers: list[McpServer]
) -> tuple[list[McpServer], list[str]]:
    """Connect each MCP server and verify it can actually list its tools.

    The Agents SDK lists each server's tools lazily inside ``Runner.run``, so a server that
    connects but fails at list time (e.g. an unauthorized Genie space) would otherwise crash
    the whole request — including unrelated turns. We list tools here, per server: healthy
    servers are kept; any that fails to connect OR to list is dropped and its name returned,
    so the agent runs with whatever is available instead of erroring out.

    Returns (healthy_servers, unavailable_names).
    """
    healthy: list[McpServer] = []
    unavailable: list[str] = []
    for server in servers:
        name = getattr(server, "name", "MCP server")
        try:
            connected = await stack.enter_async_context(server)
            await connected.list_tools()  # forces the connectivity + authorization check now
            healthy.append(connected)
        except Exception:
            logger.warning("MCP server %r unavailable; continuing without it.", name, exc_info=True)
            unavailable.append(name)
    return healthy, unavailable


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
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    # The agent runs inside an AsyncExitStack so any MCP servers stay open for the whole
    # request. To give the agent MCP tools, connect them with connect_healthy_mcp_servers,
    # which health-checks each server so one unavailable server can't crash the request
    # (the Agents SDK lists each server's tools lazily inside Runner.run):
    #   servers, unavailable = await connect_healthy_mcp_servers(
    #       stack, [await init_mcp_server(WorkspaceClient())])
    #   agent = create_agent(mcp_servers=servers)
    # WorkspaceClient() uses service principal credentials; use get_user_workspace_client()
    # for on-behalf-of user authentication.
    async with AsyncExitStack() as stack:
        agent = create_agent()
        messages = [i.model_dump() for i in request.input]
        result = await Runner.run(agent, messages)
        return ResponsesAgentResponse(output=[item.to_input_item() for item in result.new_items])


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    # The agent runs inside an AsyncExitStack so any MCP servers stay open for the whole
    # request. To give the agent MCP tools, connect them with connect_healthy_mcp_servers,
    # which health-checks each server so one unavailable server can't crash the request
    # (the Agents SDK lists each server's tools lazily inside Runner.run):
    #   servers, unavailable = await connect_healthy_mcp_servers(
    #       stack, [await init_mcp_server(WorkspaceClient())])
    #   agent = create_agent(mcp_servers=servers)
    # WorkspaceClient() uses service principal credentials; use get_user_workspace_client()
    # for on-behalf-of user authentication.
    async with AsyncExitStack() as stack:
        agent = create_agent()
        messages = [i.model_dump() for i in request.input]
        result = Runner.run_streamed(agent, input=messages)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
