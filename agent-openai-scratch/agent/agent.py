from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack

from agents import Agent, Runner, set_default_openai_api, set_default_openai_client
from databricks_openai import AsyncDatabricksOpenAI

from agent.mason import mcp_runtime, tracing

# memory_tools: swap for a databricks-openai helper when it ships.
from agent.mason.memory import memory_tools
from agent.mason.session_store import create_session
from agent.mason.wire.inbound import get_session_id
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


async def invoke_handler(request: dict) -> dict:
    """Run one turn to completion. Called by the server for POST /invocations and /responses.

    ``request`` is a Responses-shaped dict (``input`` list + optional ``session_id``); the returned
    dict carries the new output items and the ``session_id`` to pass back on the next turn.
    """
    session_id = get_session_id(request)
    tracing.tag_session(session_id)
    session = create_session(session_id)

    async with AsyncExitStack() as stack:
        agent = create_agent(mcp_servers=await mcp_runtime.connect(stack))
        result = await Runner.run(agent, request.get("input") or [], session=session)
    return {
        "output": [item.to_input_item() for item in result.new_items],
        "session_id": session.session_id,
    }


async def stream_handler(request: dict) -> AsyncGenerator[dict, None]:
    """Stream the SDK's run events as JSON dicts. Called by the server when a request sets stream=true."""
    session_id = get_session_id(request)
    tracing.tag_session(session_id)
    session = create_session(session_id)

    async with AsyncExitStack() as stack:
        agent = create_agent(mcp_servers=await mcp_runtime.connect(stack))
        result = Runner.run_streamed(agent, input=request.get("input") or [], session=session)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
