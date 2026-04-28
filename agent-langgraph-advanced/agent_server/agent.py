import asyncio
import logging
from datetime import datetime
from typing import Any, AsyncGenerator, Optional, Sequence, TypedDict

import mlflow
from databricks.sdk import WorkspaceClient
from databricks_langchain import ChatDatabricks
from fastapi import HTTPException
from langchain.agents import create_agent
from langchain_core.messages import AnyMessage
from langchain_core.tools import tool
from langgraph.graph.message import add_messages
from langgraph.store.base import BaseStore
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    to_chat_completions_input,
)
from typing_extensions import Annotated

from agent_server.prompts import SYSTEM_PROMPT
from agent_server.utils import (
    _get_or_create_thread_id,
    get_user_workspace_client,
    init_mcp_client,
    process_agent_astream_events,
)
from agent_server.utils_memory import (
    get_lakebase_access_error_message,
    get_user_id,
    init_lakebase_config,
    lakebase_context,
    memory_tools,
)

logger = logging.getLogger(__name__)
mlflow.langchain.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)
sp_workspace_client = WorkspaceClient()

LLM_ENDPOINT_NAME = "databricks-claude-sonnet-4-5"
LAKEBASE_CONFIG = init_lakebase_config()


@tool
def get_current_time() -> str:
    """Get the current date and time."""
    return datetime.now().isoformat()


@tool
def get_weather(city: str) -> str:
    """Return a short weather summary for the given city."""
    stubs = {
        "new york": "72°F, partly cloudy, light wind",
        "los angeles": "78°F, sunny, mild humidity",
        "tokyo": "65°F, rain, chance of thunderstorms",
        "paris": "60°F, overcast, occasional drizzle",
        "london": "55°F, foggy, light rain",
        "sydney": "82°F, sunny, breezy",
    }
    return stubs.get(city.lower(), f"70°F, clear skies (stub for {city})")


@tool
def get_stock_price(ticker: str) -> str:
    """Return a simulated stock price for the given ticker symbol."""
    stubs = {
        "AAPL": "$187.42 (+1.2%)",
        "GOOGL": "$141.78 (-0.4%)",
        "MSFT": "$415.06 (+0.8%)",
        "NVDA": "$885.91 (+2.7%)",
        "TSLA": "$204.33 (-1.5%)",
    }
    return stubs.get(ticker.upper(), f"$100.00 (stub for {ticker.upper()})")


@tool
def search_best_restaurants(city: str) -> str:
    """Find a short list of notable restaurants in the given city."""
    stubs = {
        "paris": "Le Comptoir du Relais, Septime, Chez L'Ami Jean",
        "tokyo": "Sukiyabashi Jiro, Narisawa, Den",
        "new york": "Eleven Madison Park, Le Bernardin, Daniel",
    }
    return stubs.get(
        city.lower(), f"Local favorites in {city}: Cafe One, The Bistro, Riverside Kitchen"
    )


@tool
async def deep_research(topic: str) -> str:
    """Run an in-depth multi-source research on the given topic. Takes ~15 seconds."""
    await asyncio.sleep(15)
    return (
        f"Research summary on '{topic}': key findings include "
        "historical context, current consensus, and two leading "
        "counter-arguments. (stubbed 15s simulated research)"
    )


class StatefulAgentState(TypedDict, total=False):
    messages: Annotated[Sequence[AnyMessage], add_messages]
    custom_inputs: dict[str, Any]
    custom_outputs: dict[str, Any]


async def init_agent(
    store: BaseStore,
    workspace_client: Optional[WorkspaceClient] = None,
    checkpointer: Optional[Any] = None,
):
    tools = [
        get_current_time,
        get_weather,
        get_stock_price,
        search_best_restaurants,
        deep_research,
    ] + memory_tools()
    # To use MCP server tools instead, uncomment the below lines:
    # mcp_client = init_mcp_client(workspace_client or sp_workspace_client)
    # try:
    #     tools.extend(await mcp_client.get_tools())
    # except Exception:
    #     logger.warning("Failed to fetch MCP tools. Continuing without MCP tools.", exc_info=True)

    model = ChatDatabricks(endpoint=LLM_ENDPOINT_NAME)

    return create_agent(
        model=model,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        checkpointer=checkpointer,
        store=store,
        state_schema=StatefulAgentState,
    )


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    outputs = [
        event.item
        async for event in stream_handler(request)
        if event.type == "response.output_item.done"
    ]

    # Surface the resolved thread_id so always-rotate works cross-turn: after a
    # crash + resume, the bridge rotates `context.conversation_id` to
    # `{base}::attempt-N`. Returning that value here lets the client send it as
    # `custom_inputs.thread_id` on the next turn, so subsequent turns land on
    # the rotated (clean) checkpointer row instead of the orphan-poisoned one.
    custom_outputs: dict[str, Any] = {"thread_id": _get_or_create_thread_id(request)}
    if user_id := get_user_id(request):
        custom_outputs["user_id"] = user_id
    return ResponsesAgentResponse(output=outputs, custom_outputs=custom_outputs)


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    thread_id = _get_or_create_thread_id(request)
    mlflow.update_current_trace(metadata={"mlflow.trace.session": thread_id})

    user_id = get_user_id(request)
    if not user_id:
        logger.warning("No user_id provided - memory features will not be available")

    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    if user_id:
        config["configurable"]["user_id"] = user_id

    input_state: dict[str, Any] = {
        "messages": to_chat_completions_input([i.model_dump() for i in request.input]),
        "custom_inputs": dict(request.custom_inputs or {}),
    }

    try:
        async with lakebase_context(LAKEBASE_CONFIG) as (checkpointer, store):
            config["configurable"]["store"] = store

            # By default, uses service principal credentials.
            # For on-behalf-of user authentication, pass get_user_workspace_client() to init_agent.
            agent = await init_agent(store=store, checkpointer=checkpointer)

            # Always-rotate dedup: when the checkpointer has state for this
            # (rotated) thread_id, trust it as authoritative for prior-turn
            # history and only forward the latest user message. Without this
            # the chatbot's full-history echo would re-inject prior turns —
            # including any orphan tool_use messages from a crashed attempt 1
            # that the rotated checkpointer state doesn't have — and
            # `add_messages` would append them, poisoning the LLM call.
            state = await agent.aget_state(config)
            if state and state.values.get("messages") and input_state["messages"]:
                last_user = next(
                    (
                        m
                        for m in reversed(input_state["messages"])
                        if m.get("role") == "user"
                    ),
                    None,
                )
                input_state["messages"] = [last_user] if last_user else []

            async for event in process_agent_astream_events(
                agent.astream(input_state, config, stream_mode=["updates", "messages"])
            ):
                yield event
    except Exception as e:
        error_msg = str(e).lower()
        # Check for Lakebase access/connection errors
        if any(
            keyword in error_msg
            for keyword in ["lakebase", "pg_hba", "postgres", "database instance"]
        ):
            logger.error("Lakebase access error: %s", e)
            raise HTTPException(
                status_code=503,
                detail=get_lakebase_access_error_message(LAKEBASE_CONFIG.description),
            ) from e
        raise
