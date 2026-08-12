import logging
from datetime import datetime
from typing import Any, AsyncGenerator, Optional, Sequence, TypedDict
from uuid import uuid4

from databricks.sdk import WorkspaceClient
from databricks_langchain import ChatDatabricks
from fastapi import HTTPException
from langchain.agents import create_agent
from langchain_core.messages import AnyMessage
from langchain_core.tools import tool
from langgraph.graph.message import add_messages
from langgraph.store.base import BaseStore
from mlflow.genai.agent_server import invoke, stream
from mlflow.entities import SpanType
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
    get_mcp_tools,
    get_user_workspace_client,
    init_mcp_client,
    process_agent_astream_events,
)
from agent_server.tracing import (
    BoundedTraceAccumulator,
    agent_request_span,
    configure_mlflow_tracing,
    set_request_trace_identity,
    traced_async_operation,
    traced_operation,
)
from agent_server.utils_memory import (
    LakebaseConfig,
    TracedCheckpointSaver,
    acquire_lakebase_resources,
    get_lakebase_access_error_message,
    get_user_id,
    init_lakebase_config,
    memory_tools,
)

logger = logging.getLogger(__name__)
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)

LLM_ENDPOINT_NAME = "databricks-gpt-5-2"
try:
    LAKEBASE_CONFIG = init_lakebase_config()
except ValueError:
    # Keep imports offline-safe. The request path still fails with the normal
    # Lakebase guidance if no endpoint/project is configured.
    LAKEBASE_CONFIG = LakebaseConfig(None, None, None)


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
    configure_mlflow_tracing()
    tools = [get_current_time] + memory_tools()
    # To use MCP server tools instead, uncomment the below lines:
    # mcp_client = init_mcp_client(workspace_client or WorkspaceClient())
    # try:
    #     tools.extend(await get_mcp_tools(mcp_client))
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

    custom_outputs: dict[str, Any] = {}
    if user_id := get_user_id(request):
        custom_outputs["user_id"] = user_id
    return ResponsesAgentResponse(output=outputs, custom_outputs=custom_outputs)


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    configure_mlflow_tracing()
    thread_id = _get_or_create_thread_id(request)
    user_id = get_user_id(request)
    if not user_id:
        logger.warning("No user_id provided - memory features will not be available")

    custom_inputs = dict(request.custom_inputs or {})
    request_id = (
        custom_inputs.get("request_id")
        or (request.metadata or {}).get("request_id")
        or str(uuid4())
    )
    trace_user_id = user_id or request.user or "anonymous"

    with agent_request_span(
        "langgraph_advanced.request", request.model_dump()
    ) as request_trace:
        set_request_trace_identity(
            str(thread_id),
            str(trace_user_id),
            str(request_id),
            "agent-langgraph-advanced",
        )
        config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
        if user_id:
            config["configurable"]["user_id"] = user_id

        with traced_operation(
            "langgraph.state.serialize",
            SpanType.PARSER,
            {
                "input": [item.model_dump() for item in request.input],
                "custom_inputs": custom_inputs,
            },
        ) as parser:
            input_state: dict[str, Any] = {
                "messages": to_chat_completions_input(
                    [item.model_dump() for item in request.input]
                ),
                "custom_inputs": custom_inputs,
            }
            parser.set_outputs(input_state)

        try:
            async with traced_async_operation(
                "lakebase.resources.acquire",
                SpanType.MEMORY,
                {"lakebase": LAKEBASE_CONFIG.description},
            ) as resource_span:
                async with acquire_lakebase_resources(LAKEBASE_CONFIG) as (
                    checkpointer,
                    store,
                ):
                    resource_span.set_outputs({"checkpointer": True, "store": True})
                    config["configurable"]["store"] = store
                    agent = await init_agent(
                        store=store,
                        checkpointer=TracedCheckpointSaver(checkpointer),
                    )
                    outputs = BoundedTraceAccumulator()
                    async for event in process_agent_astream_events(
                        agent.astream(
                            input_state,
                            config,
                            stream_mode=["updates", "messages"],
                        )
                    ):
                        outputs.add(event.model_dump(exclude_none=True))
                        yield event
                    request_trace.set_outputs({"events": outputs.snapshot()})
        except Exception as e:
            error_msg = str(e).lower()
            if any(
                keyword in error_msg
                for keyword in ["lakebase", "pg_hba", "postgres", "database instance"]
            ):
                logger.error("Lakebase access error: %s", e)
                raise HTTPException(
                    status_code=503,
                    detail=get_lakebase_access_error_message(
                        LAKEBASE_CONFIG.description
                    ),
                ) from e
            raise
