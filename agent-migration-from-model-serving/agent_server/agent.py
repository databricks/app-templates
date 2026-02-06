"""
Agent entry point — scaffold for migration.

This file contains the generic @invoke/@stream decorator pattern required by
MLflow GenAI Server. During migration, replace the TODO sections below with
the actual agent initialization, tool setup, and streaming logic from the
original Model Serving agent.
"""

from typing import AsyncGenerator

from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

# ──────────────────────────────────────────────
# TODO: Import your agent framework and tools here.
#
# Examples (pick one based on the original agent's framework):
#
#   LangGraph:
#     from databricks_langchain import ChatDatabricks
#     from langchain.agents import create_agent
#     import mlflow; mlflow.langchain.autolog()
#
#   OpenAI Agents SDK:
#     from agents import Agent, Runner
#     from databricks_openai import AsyncDatabricksOpenAI
#     import mlflow; mlflow.openai.autolog()
#
# ──────────────────────────────────────────────


# ──────────────────────────────────────────────
# TODO: Configure your LLM endpoint, system prompt, and tools.
#
# LLM_ENDPOINT_NAME = "databricks-claude-sonnet-4-5"
# SYSTEM_PROMPT = "..."
# ──────────────────────────────────────────────


# ──────────────────────────────────────────────
# TODO: Implement agent initialization.
#
# async def init_agent():
#     ...
# ──────────────────────────────────────────────


@invoke()
async def non_streaming(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    """Collect all streaming events and return the final response."""
    outputs = [
        event.item
        async for event in streaming(request)
        if event.type == "response.output_item.done"
    ]
    return ResponsesAgentResponse(output=outputs)


@stream()
async def streaming(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    """Stream agent responses.

    TODO: Replace the body of this function with your agent's streaming logic.
    """
    raise NotImplementedError(
        "Replace this with your migrated agent's streaming implementation."
    )
    # Example (LangGraph):
    #   agent = await init_agent()
    #   messages = {"messages": to_chat_completions_input([i.model_dump() for i in request.input])}
    #   async for event in process_agent_astream_events(
    #       agent.astream(input=messages, stream_mode=["updates", "messages"])
    #   ):
    #       yield event
