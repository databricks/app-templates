from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack

from agents import Agent, Runner, set_default_openai_api, set_default_openai_client
from databricks_openai import AsyncDatabricksOpenAI
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent.mason import mcp_runtime, tracing

# memory_tools: swap for a databricks-openai helper when it ships.
from agent.mason.memory import memory_tools
from agent.mason.session_store import create_session
from agent.mason.wire.inbound import deduplicate_input, get_session_id
from agent.mason.wire.outbound import process_agent_stream_events

# Importing the tools package auto-registers every tool module.
from agent.tools import all_tools


def configure() -> None:
    """Wire up global agent-SDK state; call once at server startup."""
    set_default_openai_client(AsyncDatabricksOpenAI())
    set_default_openai_api("responses")
    tracing.configure()


def create_agent(mcp_servers: list | None = None) -> Agent:
    return Agent(
        name="Agent",
        instructions="You are a helpful assistant.",
        model="databricks-gpt-5-2",
        tools=[*all_tools(), *memory_tools()],
        mcp_servers=mcp_servers or [],
    )


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    session_id = get_session_id(request)
    tracing.tag_session(session_id)
    session = create_session(session_id)

    async with AsyncExitStack() as stack:
        agent = create_agent(mcp_servers=await mcp_runtime.connect(stack))
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
    session_id = get_session_id(request)
    tracing.tag_session(session_id)
    session = create_session(session_id)

    async with AsyncExitStack() as stack:
        agent = create_agent(mcp_servers=await mcp_runtime.connect(stack))
        messages = await deduplicate_input(request, session)
        result = Runner.run_streamed(agent, input=messages, session=session)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
