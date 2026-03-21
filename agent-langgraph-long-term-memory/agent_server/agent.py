import logging
import os
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
from langgraph.store.base import BaseStore
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    to_chat_completions_input,
)

from agent_server.utils_memory import (
    get_lakebase_access_error_message,
    get_user_id,
    memory_tools,
    resolve_lakebase_instance_name,
)
from agent_server.utils_agent_memory import agent_memory_tools, read_agent_instructions
from agent_server.utils import (
    get_databricks_host_from_env,
    get_user_workspace_client,
    process_agent_astream_events,
)

logger = logging.getLogger(__name__)
mlflow.langchain.autolog()
sp_workspace_client = WorkspaceClient()

############################################
# Configuration
############################################
LLM_ENDPOINT_NAME = "databricks-claude-sonnet-4-5"
_LAKEBASE_INSTANCE_NAME_RAW = os.getenv("LAKEBASE_INSTANCE_NAME", "")
EMBEDDING_ENDPOINT = "databricks-gte-large-en"
EMBEDDING_DIMS = 1024
UC_VOLUME = os.getenv("UC_VOLUME", "")

if not _LAKEBASE_INSTANCE_NAME_RAW:
    raise ValueError(
        "LAKEBASE_INSTANCE_NAME environment variable is required but not set. "
        "Please set it in your environment:\n"
        "  LAKEBASE_INSTANCE_NAME=<your-lakebase-instance-name>\n"
    )

# Resolve hostname to instance name if needed (if given hostname of lakebase instead of name)
LAKEBASE_INSTANCE_NAME = resolve_lakebase_instance_name(_LAKEBASE_INSTANCE_NAME_RAW)

SYSTEM_PROMPT = """You are a helpful assistant. Use the available tools to answer questions.

## User Memory (per-user, private)
- Use get_user_memory to search for previously saved information about the user
- Use save_user_memory to remember important facts, preferences, or details the user shares
- Use delete_user_memory to forget specific information when asked

## Agent Memory (shared across all users)
- Use save_agent_instruction to save learnings that apply to ALL users: team preferences, process rules, best practices
- Use get_agent_instructions to read the current shared instructions

Always check for relevant user memories at the start of a conversation."""


def init_mcp_client(workspace_client: WorkspaceClient) -> DatabricksMultiServerMCPClient:
    host_name = get_databricks_host_from_env()
    return DatabricksMultiServerMCPClient(
        [
            DatabricksMCPServer(
                name="system-ai",
                url=f"{host_name}/api/2.0/mcp/functions/system/ai",
            ),
        ]
    )


async def init_agent(store: BaseStore, system_prompt: str, workspace_client: Optional[WorkspaceClient] = None):
    ws = workspace_client or sp_workspace_client
    mcp_client = init_mcp_client(ws)
    tools = await mcp_client.get_tools() + memory_tools()
    if UC_VOLUME:
        tools += agent_memory_tools(ws, UC_VOLUME)

    return create_agent(
        model=ChatDatabricks(endpoint=LLM_ENDPOINT_NAME),
        tools=tools,
        system_prompt=system_prompt,
        store=store,
    )


@invoke()
async def non_streaming(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    user_id = get_user_id(request)

    outputs = [
        event.item
        async for event in streaming(request)
        if event.type == "response.output_item.done"
    ]

    custom_outputs = {"user_id": user_id} if user_id else None
    return ResponsesAgentResponse(output=outputs, custom_outputs=custom_outputs)


@stream()
async def streaming(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    user_id = get_user_id(request)

    if not user_id:
        logger.warning("No user_id provided - memory features will not be available")

    messages: dict[str, Any] = {
        "messages": to_chat_completions_input([i.model_dump() for i in request.input])
    }

    try:
        async with AsyncDatabricksStore(
            instance_name=LAKEBASE_INSTANCE_NAME,
            embedding_endpoint=EMBEDDING_ENDPOINT,
            embedding_dims=EMBEDDING_DIMS,
        ) as store:
            await store.setup()
            config: dict[str, Any] = {"configurable": {"store": store}}
            if user_id:
                config["configurable"]["user_id"] = user_id

            full_prompt = SYSTEM_PROMPT
            if UC_VOLUME:
                instructions = read_agent_instructions(sp_workspace_client, UC_VOLUME)
                if instructions.strip():
                    full_prompt += f"\n\n## Current Agent Instructions\n{instructions}"

            agent = await init_agent(store=store, system_prompt=full_prompt)

            async for event in process_agent_astream_events(
                agent.astream(messages, config, stream_mode=["updates", "messages"])
            ):
                yield event
    except Exception as e:
        error_msg = str(e).lower()
        # Check for Lakebase access/connection errors
        if any(
            keyword in error_msg
            for keyword in ["permission"]
        ):
            logger.error(f"Lakebase access error: {e}")
            raise HTTPException(status_code=503, detail=get_lakebase_access_error_message(LAKEBASE_INSTANCE_NAME)) from e
        raise
