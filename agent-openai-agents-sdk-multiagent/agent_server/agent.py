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
from databricks_openai import AsyncDatabricksOpenAI
from databricks_openai.agents import McpServer
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import (
    build_mcp_url,
    get_user_workspace_client,
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

# Fail fast if placeholders haven't been replaced
assert not APP_AGENT_NAME.startswith("<YOUR-"), "Set APP_AGENT_NAME in agent.py before running. See README.md."
assert not GENIE_SPACE_ID.startswith("<YOUR-"), "Set GENIE_SPACE_ID in agent.py before running. See README.md."
assert not KNOWLEDGE_ASSISTANT_ENDPOINT.startswith("<YOUR-"), "Set KNOWLEDGE_ASSISTANT_ENDPOINT in agent.py before running. See README.md."
assert not SERVING_ENDPOINT.startswith("<YOUR-"), "Set SERVING_ENDPOINT in agent.py before running. See README.md."

# ---------------------------------------------------------------------------
# Client setup
# ---------------------------------------------------------------------------

# NOTE: this will work for all databricks models OTHER than GPT-OSS, which uses a slightly different API
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
set_trace_processors([])  # only use mlflow for trace processing
mlflow.openai.autolog()

# Async client used inside tool functions to query other agents / endpoints
_tool_client = AsyncDatabricksOpenAI()

# ---------------------------------------------------------------------------
# Tool functions — each wraps a call to a different backend
# ---------------------------------------------------------------------------


@function_tool
async def query_app_agent(question: str) -> str:
    """Query a specialist agent deployed as a Databricks App.

    Use this tool when the user's question should be handled by the
    specialist agent (e.g. a domain-specific assistant running on Apps).
    """
    response = await _tool_client.responses.create(
        model=f"apps/{APP_AGENT_NAME}",
        input=[{"role": "user", "content": question}],
    )
    return response.output_text


@function_tool
async def query_knowledge_assistant(question: str) -> str:
    """Query the knowledge-assistant endpoint on Model Serving.

    Use this tool for questions that require the knowledge assistant,
    such as searching internal documentation or knowledge bases.

    The endpoint must have task type ``agent/v1/responses`` (shown as
    "Agent (Responses)" on the Serving UI).
    """
    response = await _tool_client.responses.create(
        model=KNOWLEDGE_ASSISTANT_ENDPOINT,
        input=[{"role": "user", "content": question}],
    )
    return response.output_text


@function_tool
async def query_serving_endpoint(question: str) -> str:
    """Query a model hosted on a Databricks Model Serving endpoint.

    Use this tool for questions that should be answered by the model
    on the serving endpoint (e.g. a fine-tuned or specialized model).

    The endpoint must have task type ``agent/v1/responses`` (shown as
    "Agent (Responses)" on the Serving UI).
    """
    response = await _tool_client.responses.create(
        model=SERVING_ENDPOINT,
        input=[{"role": "user", "content": question}],
    )
    return response.output_text


# ---------------------------------------------------------------------------
# MCP server + orchestrator agent
# ---------------------------------------------------------------------------


async def init_mcp_server():
    """Create a Genie MCP server for natural-language data queries."""
    return McpServer(
        url=build_mcp_url(f"/api/2.0/mcp/genie/{GENIE_SPACE_ID}"),
        name="Genie space",
    )


def create_orchestrator_agent(mcp_server: McpServer) -> Agent:
    """Build the orchestrator agent with all tools and MCP servers."""
    # TODO: Update these instructions to match the tools you keep or add.
    # The more specific the instructions, the more accurately the agent will
    # route requests to the right tool.
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
        model="databricks-claude-sonnet-4-5",  # TODO: change model if desired
        mcp_servers=[mcp_server],
        tools=[query_app_agent, query_knowledge_assistant, query_serving_endpoint],
    )


# ---------------------------------------------------------------------------
# MLflow Responses API handlers
# ---------------------------------------------------------------------------


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()
    async with await init_mcp_server() as mcp_server:
        agent = create_orchestrator_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = await Runner.run(agent, messages)
        return ResponsesAgentResponse(output=sanitize_output_items(result.new_items))


@stream()
async def stream_handler(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()
    async with await init_mcp_server() as mcp_server:
        agent = create_orchestrator_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = Runner.run_streamed(agent, input=messages)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
