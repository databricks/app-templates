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

from agent_server.history import normalize_history_items

logger = logging.getLogger(__name__)


def _is_databricks_app_env() -> bool:
    """Check if running in a Databricks App environment."""
    return bool(os.getenv("DATABRICKS_APP_NAME"))


@dataclass(frozen=True)
class LakebaseConfig:
    autoscaling_endpoint: Optional[str]
    autoscaling_project: Optional[str]
    autoscaling_branch: Optional[str]
    memory_schema: Optional[str] = None

    @property
    def description(self) -> str:
        return self.autoscaling_endpoint or f"{self.autoscaling_project}/{self.autoscaling_branch}"


def init_lakebase_config() -> LakebaseConfig:
    """Read lakebase env vars and return a LakebaseConfig.

    Validates that autoscaling Lakebase is configured (endpoint, or project+branch).
    Priority: autoscaling_endpoint > project+branch.
    Only the winning mode's values are returned; others are None to avoid mutual-exclusivity
    errors in the underlying library.
    """
    endpoint = os.getenv("LAKEBASE_AUTOSCALING_ENDPOINT") or None
    project = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
    branch = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None

    has_autoscaling = project and branch
    if not endpoint and not has_autoscaling:
        raise ValueError(
            "Lakebase configuration is required but not set. "
            "Please set one of the following in your environment:\n"
            "  Option 1 (autoscaling endpoint): LAKEBASE_AUTOSCALING_ENDPOINT=<your-endpoint-name>\n"
            "  Option 2 (autoscaling): LAKEBASE_AUTOSCALING_PROJECT=<project> and LAKEBASE_AUTOSCALING_BRANCH=<branch>\n"
        )

    memory_schema = os.getenv("LAKEBASE_AGENT_MEMORY_SCHEMA") or None

    # Priority: endpoint > project+branch (mutually exclusive in the library)
    if endpoint:
        return LakebaseConfig(autoscaling_endpoint=endpoint, autoscaling_project=None, autoscaling_branch=None, memory_schema=memory_schema)
    else:
        return LakebaseConfig(autoscaling_endpoint=None, autoscaling_project=project, autoscaling_branch=branch, memory_schema=memory_schema)


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
    # Replayed assistant turns arrive id-less (chat UI sends output_text lists,
    # MLflow evaluation sends plain strings); collapse them to the easy-input
    # form every openai-agents version accepts. See agent_server/history.py.
    messages = normalize_history_items([i.model_dump() for i in request.input])
    session_items = await session.get_items()
    if len(session_items) >= len(messages) - 1:
        return [messages[-1]]
    return messages


async def process_agent_stream_events(
    async_stream: AsyncIterator[StreamEvent],
    response_id: str | None = None,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    curr_item_id = str(uuid4())
    async for event in async_stream:
        if event.type == "raw_response_event":
            event_data = event.data.model_dump()
            if response_id is not None:
                event_data = replace_fake_id(event_data, response_id)
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
