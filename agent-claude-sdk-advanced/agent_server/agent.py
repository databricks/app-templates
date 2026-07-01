import json
import logging
import os
import shutil
import time
from datetime import datetime
from typing import AsyncGenerator
from uuid import uuid4

import mlflow
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    create_sdk_mcp_server,
    query,
    tool,
)
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.settings import settings

logger = logging.getLogger(__name__)


def _get_session_id(request: ResponsesAgentRequest) -> str | None:
    if request.context and request.context.conversation_id:
        return request.context.conversation_id
    if request.custom_inputs and isinstance(request.custom_inputs, dict):
        return request.custom_inputs.get("session_id")
    return None


logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)


def _get_databricks_token() -> str:
    """Get a Databricks bearer token using SDK auto-auth, with env fallback."""
    try:
        from databricks.sdk.core import Config

        credentials = Config().authenticate()
        headers = credentials() if callable(credentials) else credentials
        authorization = headers.get("Authorization", "")
        token = authorization.removeprefix("Bearer ").strip()
        if token:
            return token
    except Exception as e:
        logger.debug("Could not get Databricks token from SDK auth: %s", e)

    token = os.getenv("DATABRICKS_TOKEN", "")
    if token:
        return token

    logger.warning("Could not get Databricks token from SDK auth or DATABRICKS_TOKEN")
    return ""


# --- Custom tools ---


@tool("get_current_time", "Get the current date and time", {})
async def get_current_time(args):
    return {"content": [{"type": "text", "text": datetime.now().isoformat()}]}


custom_tools_server = create_sdk_mcp_server(
    "custom-tools", tools=[get_current_time]
)


def _build_agent_options() -> ClaudeAgentOptions:
    """Build ClaudeAgentOptions configured for Databricks AI Gateway."""
    token = _get_databricks_token()

    env_vars = {
        "ANTHROPIC_BASE_URL": settings.ai_gateway_url,
        "ANTHROPIC_API_KEY": "dummy-key-for-cli-auth-check",
        "ANTHROPIC_AUTH_TOKEN": token,
        "CLAUDE_CODE_SKIP_AUTH_LOGIN": "true",
        "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1",
        "DATABRICKS_TOKEN": token,
        "DATABRICKS_CONFIG_PROFILE": "",
        "DATABRICKS_CLIENT_ID": "",
        "DATABRICKS_CLIENT_SECRET": "",
    }

    def _log_stderr(line: str) -> None:
        logger.debug("[claude-sdk] %s", line.rstrip())

    return ClaudeAgentOptions(
        model=settings.model,
        system_prompt=settings.system_prompt,
        env=env_vars,
        mcp_servers={"custom-tools": custom_tools_server},
        allowed_tools=["Bash", "mcp__custom-tools__*"],
        max_turns=settings.max_turns,
        permission_mode="bypassPermissions",
        include_partial_messages=True,
        cli_path=shutil.which("claude"),
        stderr=_log_stderr,
    )


def _convert_request_to_prompt(request: ResponsesAgentRequest) -> str:
    """Convert Responses API input to a prompt string for the Claude Agent SDK."""
    parts = []
    for item in request.input:
        dumped = item.model_dump()
        role = dumped.get("role", "user")
        content = dumped.get("content", "")
        if isinstance(content, list):
            text_parts = [
                c.get("text", "")
                for c in content
                if isinstance(c, dict) and c.get("type") == "input_text"
            ]
            content = "\n".join(text_parts)
        if content:
            parts.append(f"{role}: {content}")
    return "\n\n".join(parts) if parts else ""


def _new_item_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:24]}"


def _json_arguments(value) -> str:
    return json.dumps(value or {}, default=str)


def _message_item(item_id: str, text: str) -> dict:
    return {
        "type": "message",
        "id": item_id,
        "role": "assistant",
        "content": [{"type": "output_text", "text": text}],
    }


def _function_call_item(item_id: str, call_id: str, name: str, arguments) -> dict:
    return {
        "type": "function_call",
        "id": item_id,
        "call_id": call_id,
        "name": name,
        "arguments": _json_arguments(arguments),
    }


def _function_call_output_item(item_id: str, call_id: str, output) -> dict:
    return {
        "type": "function_call_output",
        "id": item_id,
        "call_id": call_id,
        "output": output if isinstance(output, str) else str(output),
    }


def _response_payload(
    response_id: str,
    created_at: int,
    status: str,
    output: list[dict] | None = None,
) -> dict:
    return {
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "status": status,
        "output": output or [],
    }


def _messages_to_response(messages: list) -> ResponsesAgentResponse:
    """Convert Claude SDK messages to ResponsesAgentResponse."""
    output = []
    for msg in messages:
        if isinstance(msg, AssistantMessage):
            for block in msg.content:
                if isinstance(block, TextBlock):
                    output.append(_message_item(_new_item_id("msg"), block.text))
                elif isinstance(block, ToolUseBlock):
                    output.append(
                        _function_call_item(
                            item_id=_new_item_id("fc"),
                            call_id=getattr(block, "id", None) or _new_item_id("call"),
                            name=block.name,
                            arguments=block.input,
                        )
                    )
                elif isinstance(block, ToolResultBlock):
                    output.append(
                        _function_call_output_item(
                            item_id=_new_item_id("fco"),
                            call_id=getattr(block, "tool_use_id", None)
                            or _new_item_id("call"),
                            output=block.content,
                        )
                    )
    return ResponsesAgentResponse(output=output)


async def _stream_to_events(
    message_iter,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    """Convert Claude SDK message stream to Responses API SSE events.

    - Text: streamed token-by-token via StreamEvent (content_block_start/delta/stop)
    - Tool use/result: emitted from AssistantMessage snapshots, deduplicated by ID
    - AssistantMessage TextBlocks are skipped (already handled by StreamEvents)
    """
    response_id = f"resp_placeholder_{uuid4().hex[:24]}"
    created_at = int(time.time())
    output_items: list[dict] = []
    output_index = 0
    current_text_item_id: str | None = None
    current_text_output_index: int | None = None
    accumulated_text = ""
    emitted_tool_ids: set[str] = set()

    yield ResponsesAgentStreamEvent(
        type="response.created",
        response=_response_payload(response_id, created_at, "in_progress"),
    )

    async for msg in message_iter:
        if isinstance(msg, StreamEvent):
            evt = msg.event
            evt_type = evt.get("type", "")

            if evt_type == "content_block_start":
                block = evt.get("content_block", {})
                if block.get("type") == "text":
                    current_text_item_id = _new_item_id("msg")
                    current_text_output_index = output_index
                    output_index += 1
                    accumulated_text = ""
                    yield ResponsesAgentStreamEvent(
                        type="response.output_item.added",
                        output_index=current_text_output_index,
                        item={
                            "type": "message",
                            "id": current_text_item_id,
                            "role": "assistant",
                            "content": [],
                        },
                    )
                    yield ResponsesAgentStreamEvent(
                        type="response.content_part.added",
                        item_id=current_text_item_id,
                        output_index=current_text_output_index,
                        content_index=0,
                        part={"type": "output_text", "text": ""},
                    )

            elif evt_type == "content_block_delta":
                delta = evt.get("delta", {})
                if delta.get("type") == "text_delta" and current_text_item_id:
                    text = delta.get("text", "")
                    accumulated_text += text
                    yield ResponsesAgentStreamEvent(
                        type="response.output_text.delta",
                        item_id=current_text_item_id,
                        output_index=current_text_output_index,
                        content_index=0,
                        delta=text,
                    )

            elif evt_type == "content_block_stop":
                if current_text_item_id and current_text_output_index is not None:
                    part = {"type": "output_text", "text": accumulated_text}
                    item = _message_item(current_text_item_id, accumulated_text)
                    yield ResponsesAgentStreamEvent(
                        type="response.output_text.done",
                        item_id=current_text_item_id,
                        output_index=current_text_output_index,
                        content_index=0,
                        text=accumulated_text,
                    )
                    yield ResponsesAgentStreamEvent(
                        type="response.content_part.done",
                        item_id=current_text_item_id,
                        output_index=current_text_output_index,
                        content_index=0,
                        part=part,
                    )
                    yield ResponsesAgentStreamEvent(
                        type="response.output_item.done",
                        output_index=current_text_output_index,
                        item=item,
                    )
                    output_items.append(item)
                    current_text_item_id = None
                    current_text_output_index = None
                    accumulated_text = ""

        elif isinstance(msg, AssistantMessage):
            # Only handle tool blocks — TextBlocks are already streamed via StreamEvents.
            # Deduplicate by tool ID since AssistantMessage snapshots repeat blocks.
            for block in msg.content:
                if isinstance(block, ToolUseBlock):
                    block_id = getattr(block, "id", None)
                    dedupe_key = f"tool:{block_id or block.name}:{_json_arguments(block.input)}"
                    if dedupe_key in emitted_tool_ids:
                        continue
                    emitted_tool_ids.add(dedupe_key)
                    item_id = _new_item_id("fc")
                    call_id = block_id or _new_item_id("call")
                    item = _function_call_item(
                        item_id=item_id,
                        call_id=call_id,
                        name=block.name,
                        arguments=block.input,
                    )
                    item_output_index = output_index
                    output_index += 1
                    yield ResponsesAgentStreamEvent(
                        type="response.output_item.added",
                        output_index=item_output_index,
                        item=item,
                    )
                    yield ResponsesAgentStreamEvent(
                        type="response.output_item.done",
                        output_index=item_output_index,
                        item=item,
                    )
                    output_items.append(item)
                elif isinstance(block, ToolResultBlock):
                    block_id = getattr(block, "tool_use_id", None)
                    content_text = (
                        block.content
                        if isinstance(block.content, str)
                        else str(block.content)
                    )
                    result_key = f"result:{block_id or content_text}"
                    if result_key in emitted_tool_ids:
                        continue
                    emitted_tool_ids.add(result_key)
                    item_id = _new_item_id("fco")
                    item = _function_call_output_item(
                        item_id=item_id,
                        call_id=block_id or _new_item_id("call"),
                        output=content_text,
                    )
                    item_output_index = output_index
                    output_index += 1
                    yield ResponsesAgentStreamEvent(
                        type="response.output_item.added",
                        output_index=item_output_index,
                        item=item,
                    )
                    yield ResponsesAgentStreamEvent(
                        type="response.output_item.done",
                        output_index=item_output_index,
                        item=item,
                    )
                    output_items.append(item)

        elif isinstance(msg, ResultMessage):
            if current_text_item_id and current_text_output_index is not None:
                part = {"type": "output_text", "text": accumulated_text}
                item = _message_item(current_text_item_id, accumulated_text)
                yield ResponsesAgentStreamEvent(
                    type="response.output_text.done",
                    item_id=current_text_item_id,
                    output_index=current_text_output_index,
                    content_index=0,
                    text=accumulated_text,
                )
                yield ResponsesAgentStreamEvent(
                    type="response.content_part.done",
                    item_id=current_text_item_id,
                    output_index=current_text_output_index,
                    content_index=0,
                    part=part,
                )
                yield ResponsesAgentStreamEvent(
                    type="response.output_item.done",
                    output_index=current_text_output_index,
                    item=item,
                )
                output_items.append(item)
                current_text_item_id = None
                current_text_output_index = None
                accumulated_text = ""

            yield ResponsesAgentStreamEvent(
                type="response.completed",
                response=_response_payload(
                    response_id,
                    created_at,
                    "completed",
                    output_items,
                ),
            )


# --- Invoke handler ---


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    if session_id := _get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})

    prompt = _convert_request_to_prompt(request)
    options = _build_agent_options()

    messages = []
    async for msg in query(prompt=prompt, options=options):
        messages.append(msg)

    return _messages_to_response(messages)


# --- Stream handler ---


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    if session_id := _get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})

    prompt = _convert_request_to_prompt(request)
    options = _build_agent_options()

    async for event in _stream_to_events(query(prompt=prompt, options=options)):
        yield event
