"""
Mock agent using the OpenAI Agents SDK with a MockAsyncOpenAI

Simulates the real agent flow:
  1. User sends "what time is it?"
  2. LLM call 1: decides to call get_current_time tool (streamed with mock delay)
  3. Tool executes, returns hardcoded time
  4. LLM call 2: summarizes the tool output (streamed with mock delay)
  5. Final response returned to user

This measures Apps infrastructure throughput through the full SDK pipeline
(Runner, streaming, tool dispatch) without any real LLM calls.

Environment variables:
    MOCK_CHUNK_DELAY_MS: Delay between text chunks in ms (default: 10)
    MOCK_CHUNK_COUNT: Number of text chunks in LLM call 2 (default: 80)
"""

import asyncio
import os
import time
from typing import AsyncGenerator

from agents import Agent, Runner, function_tool, set_default_openai_api, set_default_openai_client
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.mock_openai_client import MockAsyncOpenAI
from agent_server.utils import process_agent_stream_events

# Configure the agents SDK to use our mock client
set_default_openai_client(MockAsyncOpenAI())
set_default_openai_api("chat_completions")


HARDCODED_TIME = "2026-04-01T00:00:00+00:00"


@function_tool
def get_current_time() -> str:
    """Get the current date and time."""
    return HARDCODED_TIME


def create_agent() -> Agent:
    return Agent(
        name="LoadTestAgent",
        instructions="You are a helpful assistant. Use the get_current_time tool when asked about time.",
        model="mock-model",
        tools=[get_current_time],
    )


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    agent = create_agent()
    messages = [i.model_dump() for i in request.input]
    result = await Runner.run(agent, messages)
    return ResponsesAgentResponse(output=[item.to_input_item() for item in result.new_items])


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    agent = create_agent()
    messages = [i.model_dump() for i in request.input]
    result = Runner.run_streamed(agent, input=messages)

    async for event in process_agent_stream_events(result.stream_events()):
        yield event
