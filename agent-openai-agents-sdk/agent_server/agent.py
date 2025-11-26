from typing import AsyncGenerator

import mlflow
from agents import Agent, Runner, set_default_openai_api, set_default_openai_client
from agents.mcp import MCPServerStdio, MCPServerStreamableHttp, MCPServerStreamableHttpParams
from agents.tracing import set_trace_processors
from databricks.sdk import WorkspaceClient
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import (
    get_async_openai_client,
    get_databricks_host_from_env,
    get_user_workspace_client,
    process_agent_stream_events,
)

sp_workspace_client = WorkspaceClient()
# NOTE: this will work for all databricks models OTHER than GPT-OSS, which uses a slightly different API
databricks_openai_client = get_async_openai_client(sp_workspace_client)
set_default_openai_client(databricks_openai_client)
set_default_openai_api("chat_completions")
set_trace_processors([])  # use mlflow for trace processing
mlflow.openai.autolog()


async def init_mcp_server():
    return MCPServerStreamableHttp(
        params=MCPServerStreamableHttpParams(
            url=f"{get_databricks_host_from_env()}/api/2.0/mcp/functions/system/ai",
            headers=sp_workspace_client.config.authenticate(),
        ),
        client_session_timeout_seconds=20,
        name="system.ai uc function mcp server",
    )


def create_coding_agent(mcp_server: MCPServerStdio) -> Agent:
    return Agent(
        name="code execution agent",
        instructions="You are a code execution agent. You can execute code and return the results.",
        model="databricks-claude-3-7-sonnet",
        mcp_servers=[mcp_server],
    )


@invoke()
async def invoke(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    # user_workspace_client = get_user_workspace_client()
    async with await init_mcp_server() as mcp_server:
        agent = create_coding_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = await Runner.run(agent, messages)
        return ResponsesAgentResponse(output=[item.to_input_item() for item in result.new_items])


@stream()
async def stream(request: dict) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # user_workspace_client = get_user_workspace_client()
    async with await init_mcp_server() as mcp_server:
        agent = create_coding_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = Runner.run_streamed(agent, input=messages)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
