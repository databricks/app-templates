from typing import AsyncGenerator

import mlflow
from agents import Agent, Runner, set_default_openai_api, set_default_openai_client
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
    get_user_workspace_client,
    process_agent_stream_events, build_mcp_url,
)

# NOTE: this will work for all databricks models OTHER than GPT-OSS, which uses a slightly different API
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
set_trace_processors([])  # only use mlflow for trace processing
mlflow.openai.autolog()


MEMORY_MCP_HOST = "https://eng-ml-agent-platform.staging.cloud.databricks.com"
memory_ws_client = WorkspaceClient(host=MEMORY_MCP_HOST, profile="agent-platform")


async def init_memory_mcp_server():
    return McpServer(
        url=f"{MEMORY_MCP_HOST}/api/2.0/mcp/sql",
        name="memory-mcp",
        workspace_client=memory_ws_client,
        params={
            "headers": {"x-databricks-traffic-id": "testenv://liteswap/jenny_memory"},
        },
    )


MEMORY_STORE = "test-embed"

SYSTEM_PROMPT = f"""You are a helpful assistant with long-term memory.

## Important: Check agent memory before every response
Before responding to the user, ALWAYS call search_memory with memory_store="{MEMORY_STORE}", scope="agent", query="response preferences and procedures" to load any shared instructions that affect how you should respond.

Also call search_memory with scope="user" to check for personal context about the current user.

## Memory Tools
- write_memory: Save info. scope="user" for personal facts, scope="agent" for shared rules/procedures.
- search_memory: Search past memories. scope="user"/"agent"/"both".
- Always use memory_store="{MEMORY_STORE}" for all memory operations."""


def create_agent(mcp_server: McpServer) -> Agent:
    return Agent(
        name="Memory agent",
        instructions=SYSTEM_PROMPT,
        model="databricks-claude-sonnet-4-5",
        mcp_servers=[mcp_server],
    )


@invoke()
async def invoke(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()
    async with await init_memory_mcp_server() as mcp_server:
        agent = create_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = await Runner.run(agent, messages)
        return ResponsesAgentResponse(output=[item.to_input_item() for item in result.new_items])


@stream()
async def stream(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()
    async with await init_memory_mcp_server() as mcp_server:
        agent = create_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = Runner.run_streamed(agent, input=messages)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
