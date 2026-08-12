"""
Agent entry point — scaffold for migration.

This file contains the generic @invoke/@stream decorator pattern required by
MLflow GenAI Server. During migration, replace the TODO sections below with
the actual agent initialization, tool setup, and streaming logic from the
original Model Serving agent.
"""

import logging
import os
from typing import AsyncGenerator
from uuid import uuid4

import mlflow
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import get_session_id
from agent_server.tracing import (
    install_sanitizing_export_boundary,
    mark_autologger_called,
    set_request_trace_identity,
    validate_tracing_environment,
)

# ──────────────────────────────────────────────
# TODO: Import your agent framework and tools here.
#
# Examples (pick one based on the original agent's framework):
#
#   LangGraph:
#     from databricks_langchain import ChatDatabricks
#     from langchain.agents import create_agent
#     mlflow.langchain.autolog()
#
#   OpenAI Agents SDK:
#     from agents import Agent, Runner
#     from databricks_openai import AsyncDatabricksOpenAI
#     mlflow.openai.autolog()
#
# ──────────────────────────────────────────────

logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)

validate_tracing_environment()
install_sanitizing_export_boundary()
framework = os.environ["AGENT_FRAMEWORK"]
if framework == "langgraph":
    mlflow.langchain.autolog(log_traces=True)
elif framework == "openai":
    mlflow.openai.autolog(log_traces=True)
else:
    raise RuntimeError("AGENT_FRAMEWORK must be 'langgraph' or 'openai'")
mark_autologger_called(framework)


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
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    """Collect all streaming events and return the final response."""
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
    """Stream agent responses.

    TODO: Replace the body of this function with your agent's streaming logic.
    """
    custom_inputs = dict(request.custom_inputs or {})
    session_id = get_session_id(request) or str(uuid4())
    user_id = (
        request.user
        or custom_inputs.get("user_id")
        or (getattr(request.context, "user_id", None) if request.context else None)
        or "anonymous"
    )
    request_id = (
        custom_inputs.get("request_id")
        or (request.metadata or {}).get("request_id")
        or str(uuid4())
    )
    set_request_trace_identity(
        session_id=str(session_id),
        user_id=str(user_id),
        request_id=str(request_id),
        template_name="agent-migration-from-model-serving",
    )
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
