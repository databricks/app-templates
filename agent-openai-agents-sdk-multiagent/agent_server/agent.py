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

from contextlib import nullcontext
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
# TODO: Configure the subagents for your environment.
#   - Uncomment and configure entries in SUBAGENTS to add backends the
#     orchestrator can call.  Each entry becomes a separate tool.
#   - "type" determines how the backend is called:
#       "app"              → Responses API via apps/<endpoint>
#       "serving_endpoint" → Responses API via <endpoint> (must be task type
#                            agent/v1/responses, shown as "Agent (Responses)"
#                            on the Serving UI)
#       "genie"            → Databricks MCP server for a Genie space
#                            (requires "space_id" instead of "endpoint")
# ---------------------------------------------------------------------------

SUBAGENTS = [
    # Uncomment and configure the subagents you need. You must enable at least one.
    #
    # {
    #     "name": "genie",
    #     "type": "genie",
    #     "space_id": "<YOUR-GENIE-SPACE-ID>",  # UUID from the Genie space URL
    #     "description": (
    #         "Query a Genie space for structured data analysis. "
    #         "Use this for questions about data, metrics, and tables."
    #     ),
    # },
    # {
    #     "name": "app_agent",
    #     "type": "app",
    #     "endpoint": "<YOUR-APP-AGENT-NAME>",  # TODO: set to your Databricks App name
    #     "description": (
    #         "Query a specialist agent deployed as a Databricks App. "
    #         "Use this for questions the specialist app agent handles."
    #     ),
    # },
    # {
    #     "name": "knowledge_assistant",
    #     "type": "serving_endpoint",
    #     "endpoint": "<YOUR-KNOWLEDGE-ASSISTANT-ENDPOINT>",  # flat name, NOT a Vector Search index
    #     "description": (
    #         "Query the knowledge-assistant endpoint on Model Serving. "
    #         "Use this for knowledge-base / documentation lookups. "
    #         "The endpoint must have task type agent/v1/responses."
    #     ),
    # },
    # {
    #     "name": "serving_endpoint",
    #     "type": "serving_endpoint",
    #     "endpoint": "<YOUR-SERVING-ENDPOINT>",
    #     "description": (
    #         "Query a model hosted on a Databricks Model Serving endpoint. "
    #         "Use this for questions best answered by the serving model. "
    #         "The endpoint must have task type agent/v1/responses."
    #     ),
    # },
]

assert SUBAGENTS, (
    "Configure at least one subagent in SUBAGENTS above. "
    "Uncomment an entry and replace placeholder values. See README.md."
)

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
# Subagent tools — one tool per non-genie SUBAGENTS entry
# ---------------------------------------------------------------------------


def _make_subagent_tool(subagent: dict):
    """Create a function_tool for a single subagent definition."""
    endpoint = subagent["endpoint"]
    model = f"apps/{endpoint}" if subagent["type"] == "app" else endpoint

    async def _call(question: str) -> str:
        response = await _tool_client.responses.create(
            model=model,
            input=[{"role": "user", "content": question}],
        )
        return response.output_text

    # Give the function a unique name and docstring so the orchestrator
    # sees it as a distinct, well-described tool.
    _call.__name__ = f"query_{subagent['name']}"
    _call.__doc__ = subagent["description"]
    return function_tool(_call)


subagent_tools = [_make_subagent_tool(sa) for sa in SUBAGENTS if sa["type"] != "genie"]


# ---------------------------------------------------------------------------
# MCP server + orchestrator agent
# ---------------------------------------------------------------------------


async def init_mcp_server():
    """Create a Genie MCP server if a genie subagent is configured."""
    genie = next((sa for sa in SUBAGENTS if sa["type"] == "genie"), None)
    if genie is None:
        return nullcontext()
    return McpServer(
        url=build_mcp_url(f"/api/2.0/mcp/genie/{genie['space_id']}"),
        name=genie["description"],
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
        mcp_servers=[mcp_server] if mcp_server else [],
        tools=subagent_tools,
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
