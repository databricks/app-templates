import logging
import os
from datetime import datetime
from typing import Any, AsyncGenerator, Optional

import mlflow
from databricks.sdk import WorkspaceClient
from databricks_langchain import (
    AsyncDatabricksStore,
    ChatDatabricks,
    DatabricksMCPServer,
    DatabricksMultiServerMCPClient,
)
from fastapi import HTTPException
from langchain.agents import create_agent
from langchain_core.tools import tool
from langgraph.store.base import BaseStore
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    to_chat_completions_input,
)

from agent_server.utils import (
    get_databricks_host_from_env,
    get_session_id,
    get_user_workspace_client,
    process_agent_astream_events,
)
from agent_server.utils_memory import (
    get_lakebase_access_error_message,
    get_user_id,
    memory_tools,
    resolve_lakebase_instance_name,
)

logger = logging.getLogger(__name__)
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)
logging.getLogger("LiteLLM").setLevel(logging.WARNING)
mlflow.langchain.autolog()
sp_workspace_client = WorkspaceClient()


@tool
def get_current_time() -> str:
    """Get the current date and time."""
    return datetime.now().isoformat()


############################################
# Configuration
############################################
LLM_ENDPOINT_NAME = "databricks-claude-sonnet-4-5"
_LAKEBASE_INSTANCE_NAME_RAW = os.getenv("LAKEBASE_INSTANCE_NAME") or None
EMBEDDING_ENDPOINT = "databricks-gte-large-en"
EMBEDDING_DIMS = 1024
LAKEBASE_AUTOSCALING_PROJECT = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
LAKEBASE_AUTOSCALING_BRANCH = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None

############################################

_has_autoscaling = LAKEBASE_AUTOSCALING_PROJECT and LAKEBASE_AUTOSCALING_BRANCH
if not _LAKEBASE_INSTANCE_NAME_RAW and not _has_autoscaling:
    raise ValueError(
        "Lakebase configuration is required but not set. "
        "Please set one of the following in your environment:\n"
        "  Option 1 (provisioned): LAKEBASE_INSTANCE_NAME=<your-instance-name>\n"
        "  Option 2 (autoscaling): LAKEBASE_AUTOSCALING_PROJECT=<project> and LAKEBASE_AUTOSCALING_BRANCH=<branch>\n"
    )

# Resolve hostname to instance name if needed (if given hostname of lakebase instead of name)
LAKEBASE_INSTANCE_NAME = resolve_lakebase_instance_name(_LAKEBASE_INSTANCE_NAME_RAW) if _LAKEBASE_INSTANCE_NAME_RAW else None

SYSTEM_PROMPT = """You are a helpful assistant. Use the available tools to answer questions.

You have access to memory tools that allow you to remember information about users:
- Use get_user_memory to search for previously saved information about the user
- Use save_user_memory to remember important facts, preferences, or details the user shares
- Use delete_user_memory to forget specific information when asked

Always check for relevant memories at the start of a conversation to provide personalized responses."""


def init_mcp_client(workspace_client: WorkspaceClient) -> DatabricksMultiServerMCPClient:
    host_name = get_databricks_host_from_env()
    return DatabricksMultiServerMCPClient(
        [
            DatabricksMCPServer(
                name="system-ai",
                url=f"{host_name}/api/2.0/mcp/functions/system/ai",
                workspace_client=workspace_client,
            ),
        ]
    )


async def init_agent(store: BaseStore, workspace_client: Optional[WorkspaceClient] = None):
    tools = [get_current_time] + memory_tools()
    # To use MCP server tools instead, replace the line above with:
    # mcp_client = init_mcp_client(workspace_client or sp_workspace_client)
    # tools.extend(await mcp_client.get_tools())

    return create_agent(
        model=ChatDatabricks(endpoint=LLM_ENDPOINT_NAME),
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        store=store,
    )


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    outputs = [
        event.item
        async for event in stream_handler(request)
        if event.type == "response.output_item.done"
    ]

    user_id = get_user_id(request)
    custom_outputs = {"user_id": user_id} if user_id else None
    return ResponsesAgentResponse(output=outputs, custom_outputs=custom_outputs)


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})

    user_id = get_user_id(request)

    if not user_id:
        logger.warning("No user_id provided - memory features will not be available")

    messages: dict[str, Any] = {
        "messages": to_chat_completions_input([i.model_dump() for i in request.input])
    }

    try:
        async with AsyncDatabricksStore(
            instance_name=LAKEBASE_INSTANCE_NAME,
            project=LAKEBASE_AUTOSCALING_PROJECT,
            branch=LAKEBASE_AUTOSCALING_BRANCH,
            embedding_endpoint=EMBEDDING_ENDPOINT,
            embedding_dims=EMBEDDING_DIMS,
        ) as store:
            await store.setup()
            config: dict[str, Any] = {"configurable": {"store": store}}
            if user_id:
                config["configurable"]["user_id"] = user_id

            # By default, uses service principal credentials (sp_workspace_client).
            # For on-behalf-of user authentication, use get_user_workspace_client() instead.
            agent = await init_agent(workspace_client=sp_workspace_client, store=store)
            async for event in process_agent_astream_events(
                agent.astream(messages, config, stream_mode=["updates", "messages"])
            ):
                yield event
    except Exception as e:
        error_msg = str(e).lower()
        # Check for Lakebase access/connection errors
        if any(keyword in error_msg for keyword in ["permission"]):
            logger.error(f"Lakebase access error: {e}")
            lakebase_desc = LAKEBASE_INSTANCE_NAME or f"{LAKEBASE_AUTOSCALING_PROJECT}/{LAKEBASE_AUTOSCALING_BRANCH}"
            raise HTTPException(
                status_code=503, detail=get_lakebase_access_error_message(lakebase_desc)
            ) from e
        raise
