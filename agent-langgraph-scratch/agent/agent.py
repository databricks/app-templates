from collections.abc import AsyncGenerator

from databricks_langchain import ChatDatabricks
from langchain.agents import create_agent

from agent.mason import mcp_runtime, tracing
from agent.mason.memory import memory_tools
from agent.mason.session_store import checkpointer, thread_config
from agent.mason.wire.inbound import get_session_id
from agent.mason.wire.outbound import process_agent_astream_events

# Importing the tools package auto-registers every tool module.
from agent.tools import all_tools

MODEL = "databricks-gpt-5-2"


def configure() -> None:
    """Wire up global state; call once at server startup (not at import)."""
    tracing.configure()


async def create_agent_graph():
    """Build the LangGraph agent: local tools + long-term-memory tools + any MCP tools."""
    tools = [*all_tools(), *memory_tools(), *await mcp_runtime.mcp_tools()]
    return create_agent(model=ChatDatabricks(endpoint=MODEL), tools=tools, checkpointer=checkpointer())


async def invoke_handler(request: dict) -> dict:
    """Run one turn to completion. Called by the server for POST /invocations and /responses.

    ``request`` is a dict with an ``input`` list of LangChain message dicts + optional
    ``session_id``; the returned dict carries the run's new messages (LangChain-native shape) and the
    ``session_id`` to pass back next turn.
    """
    outputs = [
        event["message"]
        async for event in stream_handler(request)
        if event.get("type") == "message"
    ]
    return {"output": outputs, "session_id": get_session_id(request)}


async def stream_handler(request: dict) -> AsyncGenerator[dict, None]:
    """Stream the agent's run events as JSON dicts. Called by the server when stream=true."""
    session_id = get_session_id(request)
    tracing.tag_session(session_id)

    agent = await create_agent_graph()
    # Pass the client's input straight to LangGraph — LangChain accepts message dicts natively. Send
    # only the new turn's message(s); the checkpointer supplies prior history for the session's thread.
    messages = {"messages": request.get("input") or []}

    async for event in process_agent_astream_events(
        agent.astream(input=messages, config=thread_config(session_id), stream_mode=["updates", "messages"])
    ):
        yield event
