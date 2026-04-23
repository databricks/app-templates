import logging
import os
from dataclasses import dataclass
from typing import Any, AsyncGenerator, AsyncIterator, Optional
from uuid import uuid4

try:
    from agents.models.fake_id import FAKE_RESPONSES_ID
except ImportError:
    FAKE_RESPONSES_ID = "__fake_id__"
from agents.result import StreamEvent
from databricks.sdk import WorkspaceClient
from databricks_openai.agents import AsyncDatabricksSession
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentStreamEvent
from uuid_utils import uuid7

logger = logging.getLogger(__name__)


def _is_databricks_app_env() -> bool:
    """Check if running in a Databricks App environment."""
    return bool(os.getenv("DATABRICKS_APP_NAME"))


@dataclass(frozen=True)
class LakebaseConfig:
    instance_name: Optional[str]
    autoscaling_endpoint: Optional[str]
    autoscaling_project: Optional[str]
    autoscaling_branch: Optional[str]

    @property
    def description(self) -> str:
        return self.autoscaling_endpoint or self.instance_name or f"{self.autoscaling_project}/{self.autoscaling_branch}"


def _is_lakebase_hostname(value: str) -> bool:
    """Check if the value looks like a Lakebase hostname rather than an instance name."""
    return ".database." in value and value.endswith(".com")


def resolve_lakebase_instance_name(
    instance_name: str, workspace_client: WorkspaceClient | None = None
) -> str:
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
        rw_dns = getattr(instance, "read_write_dns", None)
        ro_dns = getattr(instance, "read_only_dns", None)
        if hostname in (rw_dns, ro_dns):
            resolved_name = getattr(instance, "name", None)
            if not resolved_name:
                raise ValueError(
                    f"Found matching instance for hostname '{hostname}' "
                    "but instance name is not available."
                )
            logger.info(
                "Resolved Lakebase hostname '%s' to instance name '%s'",
                hostname,
                resolved_name,
            )
            return resolved_name

    raise ValueError(
        f"Unable to find database instance matching hostname '{hostname}'. "
        "Ensure the hostname is correct and the instance exists."
    )


def init_lakebase_config() -> LakebaseConfig:
    """Read lakebase env vars and return a LakebaseConfig.

    Validates that at least one mode (endpoint, provisioned, or autoscaling) is configured.
    Priority: autoscaling_endpoint > instance_name > project+branch.
    Only the winning mode's values are returned; others are None to avoid mutual-exclusivity
    errors in the underlying library.
    """
    endpoint = os.getenv("LAKEBASE_AUTOSCALING_ENDPOINT") or None
    raw_name = os.getenv("LAKEBASE_INSTANCE_NAME") or None
    project = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
    branch = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None

    has_autoscaling = project and branch
    if not endpoint and not raw_name and not has_autoscaling:
        raise ValueError(
            "Lakebase configuration is required but not set. "
            "Please set one of the following in your environment:\n"
            "  Option 1 (autoscaling endpoint): LAKEBASE_AUTOSCALING_ENDPOINT=<your-endpoint-name>\n"
            "  Option 2 (autoscaling): LAKEBASE_AUTOSCALING_PROJECT=<project> and LAKEBASE_AUTOSCALING_BRANCH=<branch>\n"
            "  Option 3 (provisioned): LAKEBASE_INSTANCE_NAME=<your-instance-name>\n"
        )

    # Priority: endpoint > project+branch > instance_name (mutually exclusive in the library)
    if endpoint:
        return LakebaseConfig(instance_name=None, autoscaling_endpoint=endpoint, autoscaling_project=None, autoscaling_branch=None)
    elif has_autoscaling:
        return LakebaseConfig(instance_name=None, autoscaling_endpoint=None, autoscaling_project=project, autoscaling_branch=branch)
    else:
        return LakebaseConfig(instance_name=resolve_lakebase_instance_name(raw_name), autoscaling_endpoint=None, autoscaling_project=None, autoscaling_branch=None)


def get_lakebase_access_error_message(lakebase_description: str) -> str:
    """Generate a helpful error message for Lakebase access issues."""
    if _is_databricks_app_env():
        app_name = os.getenv("DATABRICKS_APP_NAME")
        return (
            f"Failed to connect to Lakebase instance '{lakebase_description}'. "
            f"The App Service Principal for '{app_name}' may not have access.\n\n"
            "To fix this:\n"
            "1. Go to the Databricks UI and navigate to your app\n"
            "2. Click 'Edit' → 'App resources' → 'Add resource'\n"
            "3. Add your Lakebase instance as a resource\n"
            "4. Grant the necessary permissions on your Lakebase instance. "
            "See the README section 'Grant Lakebase permissions to your App's Service Principal' for the SQL commands."
        )
    else:
        return (
            f"Failed to connect to Lakebase instance '{lakebase_description}'. "
            "Please verify:\n"
            "1. The instance name is correct\n"
            "2. You have the necessary permissions to access the instance\n"
            "3. Your Databricks authentication is configured correctly"
        )


# Module-level singleton — initialized once at import time, shared by agent.py and start_server.py
lakebase_config = init_lakebase_config()


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


def get_databricks_host_from_env() -> str | None:
    try:
        w = WorkspaceClient()
        return w.config.host
    except Exception:
        logger.exception("Error getting databricks host from env")
        return None


def get_user_workspace_client() -> WorkspaceClient:
    token = get_request_headers().get("x-forwarded-access-token")
    return WorkspaceClient(token=token, auth_type="pat")


def replace_fake_id(obj: Any, real_id: str) -> Any:
    """Recursively replace FAKE_RESPONSES_ID with real_id in dicts/lists/strings."""
    if isinstance(obj, dict):
        return {k: replace_fake_id(v, real_id) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [replace_fake_id(item, real_id) for item in obj]
    elif isinstance(obj, str) and obj == FAKE_RESPONSES_ID:
        return real_id
    return obj


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


_DELTA_EVENT_TO_ITEM_TYPE = {
    "response.output_text.delta": "message",
    "response.content_part.added": "message",
    "response.content_part.done": "message",
    "response.function_call_arguments.delta": "function_call",
    "response.function_call_arguments.done": "function_call",
    "response.reasoning.delta": "reasoning",
    "response.reasoning_summary_text.delta": "reasoning",
}


async def process_agent_stream_events(
    async_stream: AsyncIterator[StreamEvent],
    response_id: str | None = None,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    # Runner streams every event with FAKE_RESPONSES_ID, so we assign uuids
    # and reconstruct ownership. Two dimensions of disambiguation are
    # required for providers that emit parallel / interleaved events
    # (notably Claude via the Databricks OpenAI-compatible endpoint):
    #
    #   1. Items of different types interleave (function_call.added then
    #      message.added, then function_call.done), so we keep the current
    #      id bucket per item.type for delta routing.
    #   2. Multiple function_calls can be open at once (Claude parallel tool
    #      calling). Each call_id must map to its own uuid so the .done
    #      frames land on the right item — otherwise the most recent call's
    #      uuid gets stamped on every function_call.done.
    current_id_by_type: dict[str, str] = {}
    fc_id_by_call_id: dict[str, str] = {}

    def fc_id_for(call_id: str) -> str:
        if call_id not in fc_id_by_call_id:
            fc_id_by_call_id[call_id] = str(uuid4())
        return fc_id_by_call_id[call_id]

    async for event in async_stream:
        if event.type == "raw_response_event":
            event_data = event.data.model_dump()
            if response_id is not None:
                event_data = replace_fake_id(event_data, response_id)

            event_type = event_data.get("type", "")
            item = event_data.get("item") if isinstance(event_data.get("item"), dict) else None
            item_type = item.get("type") if item else None
            call_id = item.get("call_id") if item else None

            if event_type == "response.output_item.added" and item_type:
                if item_type == "function_call" and call_id:
                    new_id = fc_id_for(call_id)
                else:
                    new_id = str(uuid4())
                current_id_by_type[item_type] = new_id
                event_data["item"]["id"] = new_id
            elif event_type == "response.output_item.done" and item_type:
                if item_type == "function_call" and call_id:
                    # Look up by call_id — parallel tool calls each have
                    # their own registered uuid.
                    event_data["item"]["id"] = fc_id_for(call_id)
                elif item_type in current_id_by_type:
                    event_data["item"]["id"] = current_id_by_type[item_type]
            elif event_type in _DELTA_EVENT_TO_ITEM_TYPE:
                # Delta frames carry only item_id, not call_id. Route to the
                # most recently opened item of the owning type — this is
                # what Runner's stream actually implies (the current args
                # delta belongs to the current function_call).
                owner_type = _DELTA_EVENT_TO_ITEM_TYPE[event_type]
                owner_id = current_id_by_type.get(owner_type)
                if owner_id:
                    if event_data.get("item_id") is not None:
                        event_data["item_id"] = owner_id
                    if item and item.get("id") is not None:
                        event_data["item"]["id"] = owner_id

            yield event_data
        elif event.type == "run_item_stream_event" and event.item.type == "tool_call_output_item":
            yield ResponsesAgentStreamEvent(
                type="response.output_item.done",
                item=event.item.to_input_item(),
            )
