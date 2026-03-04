import logging
from typing import AsyncGenerator, AsyncIterator, Optional
from uuid import uuid4

from agents.result import StreamEvent
from databricks.sdk import WorkspaceClient
from databricks_openai.agents import AsyncDatabricksSession
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentStreamEvent
from uuid_utils import uuid7


def get_session_id(request: ResponsesAgentRequest) -> str:
    """Extract session_id from request or generate a new one."""
    # Priority:
    # 1. Use session_id from custom_inputs
    # 2. Use conversation_id from ChatContext
    #    https://mlflow.org/docs/latest/api_reference/python_api/mlflow.types.html#mlflow.types.agent.ChatContext
    # 3. Generate a new UUID
    ci = dict(request.custom_inputs or {})

    if "session_id" in ci and ci["session_id"]:
        return str(ci["session_id"])

    if request.context and getattr(request.context, "conversation_id", None):
        return str(request.context.conversation_id)

    return str(uuid7())


def _is_lakebase_hostname(value: str) -> bool:
    """Check if the value looks like a Lakebase hostname rather than an instance name."""
    return ".database." in value and value.endswith(".com")


def resolve_lakebase_instance_name(
    instance_name: str, workspace_client: Optional[WorkspaceClient] = None
) -> str:
    """
    Resolve a Lakebase instance name from a hostname if needed.

    If the input is a hostname (e.g., from Databricks Apps value_from resolution),
    resolve it to the actual instance name by looking up database instances.
    """
    if not _is_lakebase_hostname(instance_name):
        return instance_name

    client = workspace_client or WorkspaceClient()
    hostname = instance_name

    try:
        instances = list(client.database.list_database_instances())
    except Exception as exc:
        raise ValueError(
            f"Unable to list database instances to resolve hostname '{hostname}'. "
            "Ensure you have access to database instances."
        ) from exc

    for instance in instances:
        if hostname in (instance.read_write_dns, instance.read_only_dns):
            if not instance.name:
                raise ValueError(
                    f"Found matching instance for hostname '{hostname}' "
                    "but instance name is not available."
                )
            logging.info(f"Resolved Lakebase hostname '{hostname}' to instance name '{instance.name}'")
            return instance.name

    raise ValueError(
        f"Unable to find database instance matching hostname '{hostname}'. "
        "Ensure the hostname is correct and the instance exists."
    )


def get_databricks_host_from_env() -> Optional[str]:
    try:
        w = WorkspaceClient()
        return w.config.host
    except Exception as e:
        logging.exception(f"Error getting databricks host from env: {e}")
        return None


def get_user_workspace_client() -> WorkspaceClient:
    token = get_request_headers().get("x-forwarded-access-token")
    return WorkspaceClient(token=token, auth_type="pat")


async def deduplicate_input(request: ResponsesAgentRequest, session: AsyncDatabricksSession) -> list[dict]:
    """Return the input messages to pass to the Runner, avoiding duplication with session history.

    When a client sends the full conversation history AND the session already has
    that history persisted, passing everything through would duplicate messages.
    If the session already covers the prior turns, only the latest message is needed
    since the session will prepend the full history automatically.
    """
    messages = [i.model_dump() for i in request.input]
    # Normalize assistant message content from string to structured list format.
    # MLflow evaluation sends assistant content as a plain string, but the OpenAI
    # Agents SDK expects it as [{"type": "output_text", "text": ..., "annotations": []}].
    for msg in messages:
        if (
            isinstance(msg, dict)
            and msg.get("type") == "message"
            and msg.get("role") == "assistant"
            and isinstance(msg.get("content"), str)
        ):
            msg["content"] = [{"type": "output_text", "text": msg["content"], "annotations": []}]
    session_items = await session.get_items()
    if len(session_items) >= len(messages) - 1:
        return [messages[-1]]
    return messages


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
