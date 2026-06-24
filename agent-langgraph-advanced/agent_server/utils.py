import json
import logging
import os
import time as time_mod
from typing import Any, AsyncGenerator, AsyncIterator, Optional
from uuid import uuid4

import uuid_utils
from databricks.sdk import WorkspaceClient
from databricks_langchain import DatabricksMCPServer, DatabricksMultiServerMCPClient
from langchain_core.messages import AIMessageChunk, ToolMessage
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentStreamEvent,
    create_function_call_item,
    create_function_call_output_item,
    create_text_output_item,
)


def _get_or_create_thread_id(request: ResponsesAgentRequest) -> str:
    # priority of getting thread id:
    # 1. Use thread id from custom inputs
    # 2. Use conversation id from ChatContext https://mlflow.org/docs/latest/api_reference/python_api/mlflow.types.html#mlflow.types.agent.ChatContext
    # 3. Generate random UUID
    ci = dict(request.custom_inputs or {})

    if "thread_id" in ci and ci["thread_id"]:
        return str(ci["thread_id"])

    if request.context and getattr(request.context, "conversation_id", None):
        return str(request.context.conversation_id)

    return str(uuid_utils.uuid7())


def _is_databricks_app_env() -> bool:
    """Check if running in a Databricks App environment."""
    return bool(os.getenv("DATABRICKS_APP_NAME"))


async def deduplicate_input(
    agent: Any, config: dict[str, Any], messages: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Drop UI-echoed history when the checkpointer already holds the thread.

    The chatbot UI replays the full conversation on each turn, but LangGraph's
    checkpointer already has the prior messages keyed by ``thread_id``. Sending
    them again duplicates everything in the agent's view. When we detect an
    existing checkpoint for this thread, keep only the latest user message.
    """
    if not messages:
        return messages
    try:
        state = await agent.aget_state(config)
    except Exception:
        return messages
    if state and state.values.get("messages"):
        return messages[-1:]
    return messages


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


def get_user_workspace_client() -> WorkspaceClient:
    token = get_request_headers().get("x-forwarded-access-token")
    return WorkspaceClient(token=token, auth_type="pat")


def get_databricks_host_from_env() -> Optional[str]:
    try:
        w = WorkspaceClient()
        return w.config.host
    except Exception as e:
        logging.exception("Error getting databricks host from env: %s", e)
        return None


_FAKE_ID_PREFIX = "resp_placeholder_"


def replace_fake_id(obj: Any, real_id: str) -> Any:
    """Recursively replace any resp_placeholder_* ID with real_id in dicts/lists/strings."""
    if isinstance(obj, dict):
        return {k: replace_fake_id(v, real_id) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [replace_fake_id(item, real_id) for item in obj]
    elif isinstance(obj, str) and obj.startswith(_FAKE_ID_PREFIX):
        return real_id
    return obj


async def process_agent_astream_events(
    async_stream: AsyncIterator[Any],
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    response_id = f"{_FAKE_ID_PREFIX}{uuid4().hex[:16]}"
    in_turn = False
    turn_output_items: list[dict] = []
    output_index = 0
    active_text_item_id: str | None = None
    active_text_content = ""
    active_tool_calls: dict[int, dict] = {}

    def _response_obj(output: list[dict] | None = None) -> dict:
        return {
            "id": response_id,
            "created_at": time_mod.time(),
            "object": "response",
            "output": output or [],
            "status": None,
        }

    def _start_turn():
        nonlocal in_turn, turn_output_items
        in_turn = True
        turn_output_items = []

    def _end_turn():
        nonlocal in_turn, active_text_item_id, active_text_content
        in_turn = False
        active_text_item_id = None
        active_text_content = ""

    async for event in async_stream:
        if event[0] == "messages":
            try:
                chunk = event[1][0]
                if not isinstance(chunk, AIMessageChunk):
                    continue

                if not in_turn:
                    _start_turn()
                    yield ResponsesAgentStreamEvent(
                        type="response.created",
                        response=_response_obj(),
                    )

                # Tool call chunks
                if chunk.tool_call_chunks:
                    for tc_chunk in chunk.tool_call_chunks:
                        idx = tc_chunk.get("index", 0)
                        name = tc_chunk.get("name") or ""
                        tc_id = tc_chunk.get("id") or ""
                        args = tc_chunk.get("args") or ""

                        if idx not in active_tool_calls:
                            item_id = str(uuid_utils.uuid7())
                            active_tool_calls[idx] = {
                                "item_id": item_id,
                                "name": name,
                                "args": "",
                                "call_id": tc_id,
                                "output_index": output_index,
                            }
                            output_index += 1
                            yield ResponsesAgentStreamEvent(
                                type="response.output_item.added",
                                item={
                                    "type": "function_call",
                                    "id": item_id,
                                    "call_id": tc_id,
                                    "name": name,
                                    "arguments": "",
                                },
                                output_index=active_tool_calls[idx]["output_index"],
                            )
                        else:
                            tc_info = active_tool_calls[idx]
                            if name and not tc_info["name"]:
                                tc_info["name"] = name
                            if tc_id and not tc_info["call_id"]:
                                tc_info["call_id"] = tc_id

                        if args:
                            active_tool_calls[idx]["args"] += args
                            yield ResponsesAgentStreamEvent(
                                type="response.function_call_arguments.delta",
                                delta=args,
                                item_id=active_tool_calls[idx]["item_id"],
                                output_index=active_tool_calls[idx]["output_index"],
                            )

                # Text content
                elif chunk.content:
                    content = chunk.content
                    if not active_text_item_id:
                        active_text_item_id = str(uuid_utils.uuid7())
                        active_text_content = ""
                        yield ResponsesAgentStreamEvent(
                            type="response.output_item.added",
                            item={
                                "type": "message",
                                "id": active_text_item_id,
                                "role": "assistant",
                                "status": "in_progress",
                                "content": [],
                            },
                            output_index=output_index,
                        )
                        yield ResponsesAgentStreamEvent(
                            type="response.content_part.added",
                            item_id=active_text_item_id,
                            output_index=output_index,
                            content_index=0,
                            part={"type": "output_text", "text": "", "annotations": []},
                        )

                    active_text_content += content
                    yield ResponsesAgentStreamEvent(
                        type="response.output_text.delta",
                        delta=content,
                        item_id=active_text_item_id,
                        content_index=0,
                        output_index=output_index,
                    )

            except Exception as e:
                logging.exception(f"Error processing agent stream event: {e}")

        elif event[0] == "updates":
            for node_data in event[1].values():
                messages = node_data.get("messages", [])
                if not messages:
                    continue

                has_ai_message = False

                for i, msg in enumerate(messages):
                    if isinstance(msg, ToolMessage):
                        # Tool result — standalone event between turns
                        content = msg.content if isinstance(msg.content, str) else json.dumps(msg.content)
                        item = create_function_call_output_item(
                            call_id=msg.tool_call_id,
                            output=content,
                        )
                        yield ResponsesAgentStreamEvent(
                            type="response.output_item.done",
                            item=item,
                        )

                    elif hasattr(msg, "tool_calls") and msg.tool_calls:
                        has_ai_message = True
                        if not in_turn:
                            _start_turn()
                            yield ResponsesAgentStreamEvent(
                                type="response.created",
                                response=_response_obj(),
                            )

                        for j, tc in enumerate(msg.tool_calls):
                            call_id = tc.get("id", "")
                            name = tc.get("name", "")
                            args = tc.get("args", {})
                            args_str = json.dumps(args) if isinstance(args, dict) else str(args)

                            # Match to active tool call by chunk index
                            tc_info = active_tool_calls.get(j)
                            if tc_info:
                                item_id = tc_info["item_id"]
                                matched_oi = tc_info["output_index"]
                            else:
                                item_id = str(uuid_utils.uuid7())
                                matched_oi = output_index
                                output_index += 1

                            item = create_function_call_item(
                                id=item_id,
                                call_id=call_id,
                                name=name,
                                arguments=args_str,
                            )
                            turn_output_items.append(item)
                            yield ResponsesAgentStreamEvent(
                                type="response.output_item.done",
                                item=item,
                                output_index=matched_oi,
                            )

                        active_tool_calls.clear()

                    elif hasattr(msg, "content") and msg.content:
                        has_ai_message = True
                        if not in_turn:
                            _start_turn()
                            yield ResponsesAgentStreamEvent(
                                type="response.created",
                                response=_response_obj(),
                            )

                        text = msg.content
                        item_id = active_text_item_id or str(uuid_utils.uuid7())

                        if not active_text_item_id:
                            yield ResponsesAgentStreamEvent(
                                type="response.output_item.added",
                                item={
                                    "type": "message",
                                    "id": item_id,
                                    "role": "assistant",
                                    "status": "in_progress",
                                    "content": [],
                                },
                                output_index=output_index,
                            )
                            yield ResponsesAgentStreamEvent(
                                type="response.content_part.added",
                                item_id=item_id,
                                output_index=output_index,
                                content_index=0,
                                part={"type": "output_text", "text": "", "annotations": []},
                            )

                        yield ResponsesAgentStreamEvent(
                            type="response.content_part.done",
                            item_id=item_id,
                            output_index=output_index,
                            content_index=0,
                            part={"type": "output_text", "text": text, "annotations": []},
                        )

                        item = create_text_output_item(text=text, id=item_id)
                        item["status"] = "completed"
                        turn_output_items.append(item)
                        yield ResponsesAgentStreamEvent(
                            type="response.output_item.done",
                            item=item,
                            output_index=output_index,
                        )
                        output_index += 1
                        active_text_item_id = None
                        active_text_content = ""

                if has_ai_message and in_turn:
                    yield ResponsesAgentStreamEvent(
                        type="response.completed",
                        response=_response_obj(turn_output_items),
                    )
                    _end_turn()
