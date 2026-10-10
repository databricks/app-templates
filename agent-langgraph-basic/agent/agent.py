from collections.abc import AsyncGenerator

from databricks_langchain import ChatDatabricks
from langchain.agents import create_agent
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    to_chat_completions_input,
)

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
    session_id = get_session_id(request)
    tracing.tag_session(session_id)

    agent = await create_agent_graph()
    messages = {"messages": to_chat_completions_input([i.model_dump() for i in request.input])}

    async for event in process_agent_astream_events(
        agent.astream(input=messages, config=thread_config(session_id), stream_mode=["updates", "messages"])
    ):
        yield event
