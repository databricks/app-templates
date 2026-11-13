import json
import logging
from typing import AsyncGenerator, AsyncIterator, Optional
from uuid import uuid4

from agents.result import StreamEvent
from databricks.sdk import WorkspaceClient
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentStreamEvent

MAX_INPUT_ITEMS = 500
MAX_INPUT_ITEM_CHARS = 100_000
MAX_CUSTOM_INPUTS_CHARS = 10_000
DISALLOWED_INPUT_ROLES = {"system", "developer"}


def _check_input_limits(request: ResponsesAgentRequest, items: list[dict]) -> None:
    if len(items) > MAX_INPUT_ITEMS:
        raise ValueError(f"Too many input items (limit {MAX_INPUT_ITEMS}).")
    if any(len(json.dumps(item, default=str)) > MAX_INPUT_ITEM_CHARS for item in items):
        raise ValueError(f"Input item too large (limit {MAX_INPUT_ITEM_CHARS} characters).")
    if len(json.dumps(request.custom_inputs or {}, default=str)) > MAX_CUSTOM_INPUTS_CHARS:
        raise ValueError(f"custom_inputs too large (limit {MAX_CUSTOM_INPUTS_CHARS} characters).")


def check_request_limits(body: dict) -> None:
    """Raise ``ValueError`` if a POST /invocations or /responses body is over the input limits."""
    try:
        request = ResponsesAgentRequest(**body)
    except Exception:
        # AgentServer rejects bodies that aren't a valid request with its own 400.
        return
    _check_input_limits(request, [i.model_dump() for i in request.input])


def get_validated_input(request: ResponsesAgentRequest) -> list[dict]:
    """Return ``request.input`` as dicts after enforcing size limits.

    ``system`` and ``developer`` items are dropped so callers can't replace the agent's
    own instructions; user, assistant and tool-call items pass through unchanged.
    """
    # The agent is stateless and the client owns the history: prior assistant and tool
    # turns are not verified, so nothing in them can be trusted for authorization.
    items = [i.model_dump() for i in request.input]
    _check_input_limits(request, items)
    allowed = [item for item in items if item.get("role") not in DISALLOWED_INPUT_ROLES]
    if len(allowed) < len(items):
        logging.warning("Dropped %d system/developer input item(s)", len(items) - len(allowed))
    return allowed


def get_session_id(request: ResponsesAgentRequest) -> str | None:
    if request.context and request.context.conversation_id:
        return request.context.conversation_id
    if request.custom_inputs and isinstance(request.custom_inputs, dict):
        return request.custom_inputs.get("session_id")
    return None


def get_databricks_host(workspace_client: WorkspaceClient | None = None) -> Optional[str]:
    workspace_client = workspace_client or WorkspaceClient()
    try:
        return workspace_client.config.host
    except Exception as e:
        logging.exception(f"Error getting databricks host from env: {e}")
        return None


def build_mcp_url(path: str, workspace_client: WorkspaceClient | None = None) -> str:
    if not path.startswith("/"):
        return path
    hostname = get_databricks_host(workspace_client)
    return f"{hostname}{path}"


def get_user_workspace_client() -> WorkspaceClient:
    token = get_request_headers().get("x-forwarded-access-token")
    return WorkspaceClient(token=token, auth_type="pat")


async def process_agent_stream_events(
    async_stream: AsyncIterator[StreamEvent],
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    curr_item_id = str(uuid4())
    async for event in async_stream:
        if event.type == "raw_response_event":
            event_data = event.data.model_dump()
            if event_data["type"] == "response.output_item.added":
                curr_item_id = str(uuid4())
                event_data["item"]["id"] = curr_item_id
            elif event_data.get("item") is not None and event_data["item"].get("id") is not None:
                event_data["item"]["id"] = curr_item_id
            elif event_data.get("item_id") is not None:
                event_data["item_id"] = curr_item_id
            yield event_data
        elif event.type == "run_item_stream_event" and event.item.type == "tool_call_output_item":
            yield ResponsesAgentStreamEvent(
                type="response.output_item.done",
                item=event.item.to_input_item(),
            )
