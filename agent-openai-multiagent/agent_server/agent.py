"""
Multi-agent orchestrator template.

!! CONFIGURATION REQUIRED !!
This template is NOT ready to run out of the box. You must configure the
placeholder values below before running. Search for "TODO:" to find all
values that need to be set.

This agent demonstrates querying multiple backends from a single orchestrator:
  1. Another agent deployed as a Databricks App  (via DatabricksOpenAI Responses API)
  2. A Genie space                                (via built-in Databricks MCP server)
  3. A knowledge-assistant serving endpoint        (via DatabricksOpenAI Responses API)
  4. A model on a serving endpoint                 (via DatabricksOpenAI Responses API)

NOTE: The serving endpoint tools use the Responses API exclusively. Your
endpoints must be Responses API-compatible — these appear as "Agent
(Responses)" in the Task column on the Serving UI in Databricks. Endpoints
that only support the Chat Completions API ("LLM" task type) will NOT work
with this template as-is.
"""

from typing import AsyncGenerator

import mlflow
from agents import Agent, Runner, function_tool, set_default_openai_api, set_default_openai_client
from agents.tracing import set_trace_processors
from databricks_openai import AsyncDatabricksOpenAI, DatabricksOpenAI
from databricks_openai.agents import McpServer
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import (
    build_mcp_url,
    process_agent_stream_events,
    sanitize_output_items,
)

# ---------------------------------------------------------------------------
# TODO: Configure these values for your environment
# ---------------------------------------------------------------------------

# Name of another agent deployed as a Databricks App (e.g. "my-specialist-agent")
APP_AGENT_NAME = "<YOUR-APP-AGENT-NAME>"  # TODO: set to your Databricks App name

# Genie space ID (UUID from the Genie space URL, e.g. "01abc234def567890abc1234def56789")
GENIE_SPACE_ID = "<YOUR-GENIE-SPACE-ID>"  # TODO: set to your Genie space ID

# Serving endpoint name for a knowledge assistant — must be a Responses API endpoint
# (shows as "Agent (Responses)" in the Task column on the Serving UI).
# This is the flat endpoint name (e.g. "my-ka-endpoint"), NOT a Vector Search index
# (catalog.schema.index) or other 3-part name.
KNOWLEDGE_ASSISTANT_ENDPOINT = "<YOUR-KNOWLEDGE-ASSISTANT-ENDPOINT>"  # TODO: set to your endpoint name

# Serving endpoint name for another agent/model — must be a Responses API endpoint
# (shows as "Agent (Responses)" in the Task column on the Serving UI).
SERVING_ENDPOINT = "<YOUR-SERVING-ENDPOINT>"  # TODO: set to your endpoint name

# ---------------------------------------------------------------------------
# Client setup
# ---------------------------------------------------------------------------

# Async client used by the orchestrator agent for its own LLM calls
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
set_trace_processors([])  # only use mlflow for trace processing
mlflow.openai.autolog()

# Sync client used inside tool functions to query other agents / endpoints
_tool_client = DatabricksOpenAI()

# ---------------------------------------------------------------------------
# Tool functions — each wraps a call to a different backend
# ---------------------------------------------------------------------------


@function_tool
def query_app_agent(question: str) -> str:
    """Query a specialist agent deployed as a Databricks App.

    Use this tool when the user's question should be handled by the
    specialist agent (e.g. a domain-specific assistant running on Apps).
    """
    response = _tool_client.responses.create(
        model=f"apps/{APP_AGENT_NAME}",
        input=[{"role": "user", "content": question}],
    )
    return response.output_text


@function_tool
def query_knowledge_assistant(question: str) -> str:
    """Query the knowledge-assistant endpoint on Model Serving.

    Use this tool for questions that require the knowledge assistant,
    such as searching internal documentation or knowledge bases.
    """
    response = _tool_client.responses.create(
        model=KNOWLEDGE_ASSISTANT_ENDPOINT,
        input=[{"role": "user", "content": question}],
    )
    return response.output_text


@function_tool
def query_serving_endpoint(question: str) -> str:
    """Query a model hosted on a Databricks Model Serving endpoint.

    Use this tool for questions that should be answered by the model
    on the serving endpoint (e.g. a fine-tuned or specialized model).
    """
    response = _tool_client.responses.create(
        model=SERVING_ENDPOINT,
        input=[{"role": "user", "content": question}],
    )
    return response.output_text


# ---------------------------------------------------------------------------
# MCP server + orchestrator agent
# ---------------------------------------------------------------------------


async def init_genie_mcp_server():
    """Create a Genie MCP server for natural-language data queries."""
    return McpServer(
        url=build_mcp_url(f"/api/2.0/mcp/genie/{GENIE_SPACE_ID}"),
        name="Genie space",
    )


def create_orchestrator_agent(genie_mcp: McpServer) -> Agent:
    """Build the orchestrator agent with all tools and MCP servers."""
    return Agent(
        name="Orchestrator",
        instructions=(
            "You are an orchestrator agent. Route the user's request to the "
            "most appropriate tool or data source:\n"
            "- Use the Genie MCP tools for questions about structured data.\n"
            "- Use query_app_agent for questions that the specialist app agent handles.\n"
            "- Use query_knowledge_assistant for knowledge-base / documentation lookups.\n"
            "- Use query_serving_endpoint for questions best answered by the serving model.\n"
            "If unsure, ask the user for clarification."
        ),
        model="databricks-claude-sonnet-4",  # TODO: change model if desired
        mcp_servers=[genie_mcp],
        tools=[query_app_agent, query_knowledge_assistant, query_serving_endpoint],
    )


# ---------------------------------------------------------------------------
# MLflow Responses API handlers
# ---------------------------------------------------------------------------


@invoke()
async def invoke(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    async with await init_genie_mcp_server() as genie_mcp:
        agent = create_orchestrator_agent(genie_mcp)
        messages = [i.model_dump() for i in request.input]
        result = await Runner.run(agent, messages)
        return ResponsesAgentResponse(output=sanitize_output_items(result.new_items))


@stream()
async def stream(request: dict) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    async with await init_genie_mcp_server() as genie_mcp:
        agent = create_orchestrator_agent(genie_mcp)
        messages = [i.model_dump() for i in request.input]
        result = Runner.run_streamed(agent, input=messages)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
