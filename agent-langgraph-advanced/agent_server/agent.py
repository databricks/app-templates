import logging
from datetime import datetime
from typing import Any, AsyncGenerator, Optional, Sequence, TypedDict

import mlflow
from databricks.sdk import WorkspaceClient
from databricks_langchain import ChatDatabricks, build_tool_resume_repair_middleware
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


class StatefulAgentState(TypedDict, total=False):
    messages: Annotated[Sequence[AnyMessage], add_messages]
    custom_inputs: dict[str, Any]
    custom_outputs: dict[str, Any]


async def init_agent(
    store: BaseStore,
    workspace_client: Optional[WorkspaceClient] = None,
    checkpointer: Optional[Any] = None,
):
    tools = [get_current_time] + memory_tools()
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
        # Durable-resume repair: a kill mid-tool leaves an AIMessage with
        # tool_calls whose ToolMessage responses never landed. This
        # middleware injects synthetic ToolMessages before every model
        # call; no-op on the happy path.
        middleware=[build_tool_resume_repair_middleware()],
    )


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    outputs = [
        event.item
        async for event in stream_handler(request)
        if event.type == "response.output_item.done"
    ]

    custom_outputs: dict[str, Any] = {}
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

    input_messages = to_chat_completions_input([i.model_dump() for i in request.input])

    try:
        async with lakebase_context(LAKEBASE_CONFIG) as (checkpointer, store):
            config["configurable"]["store"] = store

            # By default, uses service principal credentials.
            # For on-behalf-of user authentication, pass get_user_workspace_client() to init_agent.
            agent = await init_agent(store=store, checkpointer=checkpointer)

            # If the thread has history in the checkpointer, only forward the
            # latest user turn — prior turns already live in state. Echoing the
            # full conversation (common from UI clients) can re-inject orphan
            # tool_uses left over in the client's buffer from a previously
            # interrupted attempt, tripping Anthropic's tool_use → tool_result
            # pairing check on the next LLM call.
            state = await agent.aget_state(config)
            if state and state.values.get("messages") and input_messages:
                last_user = next(
                    (m for m in reversed(input_messages) if m.get("role") == "user"),
                    None,
                )
                input_messages = [last_user] if last_user else []

            input_state: dict[str, Any] = {
                "messages": input_messages,
                "custom_inputs": dict(request.custom_inputs or {}),
            }

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
