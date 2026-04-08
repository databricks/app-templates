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

import litellm
import logging
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
    get_session_id,
    get_user_workspace_client,
    process_agent_stream_events,
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
    
    {
        "name": "genie",
        "type": "genie",
        "space_id": "01f1194369d51722bebd39bfdaf266d7",  # UUID from the Genie space URL
        "description": (
            "Query a Genie space for structured data analysis. "
            "Use this for questions about data, metrics, and tables."
            "Query structured data and generate charts/visualizations. "
            "Use this for SQL queries, metrics, dashboards, bar charts, line charts, pie charts, stack bar charts, histogram charts, funnel charts, etc. , trends, and any tabular data analysis."
        ),
    },
    {
        "name": "agent_code_analyzer",
        "type": "app",
        "endpoint": "agent-code-analyzer",  # TODO: set to your Databricks App name
        "description": (
            "Query a specialist agent deployed as a Databricks App. "
            "Use this this agent questions about the codebase, get explanations of code snippets, and generate new code based on the codebase. Use this for software development, code analysis, and any code-related questions. Prefer this for code-related questions. Additionally, it helps to fix bugs and suggest improvements in the codebase if the user asks for it or provides github repository links."
        ),
    },
    {
        "name": "knowledge_assistant",
        "type": "serving_endpoint",
        "endpoint": "ka-6a709152-endpoint",  # flat name, NOT a Vector Search index
        "description": (
            "Query the knowledge-assistant endpoint on Model Serving. "
            # "Use this for knowledge-base / documentation lookups. "
            "The endpoint must have task type agent/v1/responses."
            "Search through documents, PDFs, knowledge bases, and "
            "unstructured text. Use this for document summarization, "
            "RAG-based Q&A, and extracting info from unstructured sources."
        ),
    },
    {
        "name": "master_prompt_agent",
        "type": "serving_endpoint",
        "endpoint": "https://dbc-5c6e6e7d-7beb.cloud.databricks.com/serving-endpoints/databricks-gpt-5-4/invocations",
        "description": (
            "Query a model hosted on a Databricks Model Serving endpoint. "
            "Use this for generate master prompt instructions as per user query."
            "The endpoint must have task type agent/v1/responses."
        ),
    },
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
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)
litellm.suppress_debug_info = True

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
            # "You are an orchestrator agent. Route the user's request to the "
            # "most appropriate tool or data source:\n"
            # "- Use the Genie MCP tools for questions about structured data.\n"
            # "- Use query_app_agent for questions that the specialist app agent handles.\n"
            # "- Use query_knowledge_assistant for knowledge-base / documentation lookups.\n"
            # "- Use query_serving_endpoint for questions best answered by the serving model.\n"
            # "If unsure, ask the user for clarification."
            "You are the AI Orchestrator for Gilead Organization. "
            "Your role is to understand the user's intent and route their "
            "request to the most appropriate specialist agent.\n\n"

            "## Routing Rules:\n"
            "- **Structured Data / Charts / Visualization**: Use the Genie MCP tools "
            "for any question about sales data, revenue metrics, KPIs, dashboards, "
            "charts (bar, line, pie, histogram, funnel, stacked bar), trend analysis, "
            "or any SQL-queryable data.\n"
            "- **Documents / Knowledge Base / Unstructured Data**: Use "
            "query_knowledge_assistant for questions about policies, SOPs, reports, "
            "PDFs, compliance documents, or any text-based knowledge lookup.\n"
            "- **Code / Software Development**: Use query_agent_code_analyzer "
            "for questions about code, repositories, bug fixes, code generation, "
            "or software development tasks.\n"
            "- **Master Prompts / Custom Logic**: Use query_master_prompt_agent "
            "for generating master prompt instructions or custom model queries.\n\n"

            "## Response Guidelines:\n"
            "- Always be professional and concise.\n"
            "- When returning chart data, describe what the chart shows.\n"
            "- When citing documents, mention the source.\n"
            "- If unsure which agent to use, ask the user for clarification.\n"
            "- Never fabricate data — only use what the specialist agents return."
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
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()
    async with await init_mcp_server() as mcp_server:
        agent = create_orchestrator_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = await Runner.run(agent, messages)
        return ResponsesAgentResponse(output=[item.to_input_item() for item in result.new_items])


@stream()
async def stream_handler(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()
    async with await init_mcp_server() as mcp_server:
        agent = create_orchestrator_agent(mcp_server)
        messages = [i.model_dump() for i in request.input]
        result = Runner.run_streamed(agent, input=messages)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
