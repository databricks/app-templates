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


@dataclass(frozen=True)
class LakebaseConfig:
    instance_name: Optional[str]
    autoscaling_endpoint: Optional[str]
    autoscaling_project: Optional[str]
    autoscaling_branch: Optional[str]


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


def _item_get(item, key):
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def _item_dict(item):
    """Normalize an item to a plain dict for re-persistence."""
    if isinstance(item, dict):
        return dict(item)
    if hasattr(item, "model_dump"):
        return item.model_dump()
    return dict(item.__dict__) if hasattr(item, "__dict__") else {}


async def _sanitize_session(session: AsyncDatabricksSession) -> None:
    """Rebuild the session so the conversation is valid for the next LLM call.

    Two failure modes to handle on each turn:

    1. **Orphan tool_calls from durable resume.** A kill mid-tool leaves
       ``function_call`` items in the session with no matching
       ``function_call_output``. The next ``Runner.run`` fails 400 with
       'assistant message with tool_calls must be followed by tool
       messages…'.

    2. **Duplicate items from client history echo.** The Vercel AI SDK
       on the frontend re-sends the full conversation in ``request.input``
       every turn. Our ``deduplicate_input`` trims it down to just the
       latest user message on the fast path, but on a resumed turn the
       SDK can still re-persist prior items (same ``call_id`` appearing
       twice). Duplicate ``function_call`` items confuse the LLM API
       even when every call_id has *an* output.

    Fix: walk the items in chronological order, dedupe by ``call_id`` for
    function_call / function_call_output, and inject a synthetic
    ``function_call_output`` immediately after any ``function_call`` whose
    matching output isn't present. Clear the session and re-add the
    sanitized list so positional ordering is restored (SQLAlchemySession's
    ``add_items`` only appends).

    No-op if the session is already clean.
    """
    items = await session.get_items()
    if not items:
        return

    # First pass: collect call_ids that have outputs anywhere in the history.
    call_ids_with_output: set[str] = set()
    for item in items:
        if _item_get(item, "type") == "function_call_output":
            cid = _item_get(item, "call_id")
            if cid:
                call_ids_with_output.add(cid)

    # Second pass: build the canonical sequence. Dedup function_call /
    # function_call_output by call_id, insert synthetic outputs where
    # missing, keep messages / other items as-is.
    sanitized: list[dict] = []
    seen_calls: set[str] = set()
    seen_outputs: set[str] = set()
    needed_injection: list[str] = []

    for item in items:
        t = _item_get(item, "type")
        cid = _item_get(item, "call_id")
        if t == "function_call" and cid:
            if cid in seen_calls:
                continue  # drop duplicate
            seen_calls.add(cid)
            sanitized.append(_item_dict(item))
            # If this function_call has no matching output anywhere in the
            # session, inject a synthetic one immediately after it.
            if cid not in call_ids_with_output:
                name = _item_get(item, "name") or ""
                sanitized.append(
                    {
                        "type": "function_call_output",
                        "call_id": cid,
                        "output": (
                            f"Tool call '{name}' was interrupted by a durable "
                            "resume and did not complete. Please retry if "
                            "still needed."
                        ),
                    }
                )
                needed_injection.append(cid)
        elif t == "function_call_output" and cid:
            if cid in seen_outputs:
                continue  # drop duplicate output
            seen_outputs.add(cid)
            sanitized.append(_item_dict(item))
        else:
            sanitized.append(_item_dict(item))

    # If the sanitized sequence equals the original (same count, no orphans,
    # no duplicates), skip the clear+rebuild — it's a no-op and saves DB work.
    if len(sanitized) == len(items) and not needed_injection:
        return

    logger.info(
        "Sanitizing session %s: original=%d items, sanitized=%d items, "
        "synthetic outputs injected=%d (call_ids=%s)",
        session.session_id,
        len(items),
        len(sanitized),
        len(needed_injection),
        needed_injection,
    )
    await session.clear_session()
    if sanitized:
        await session.add_items(sanitized)


async def deduplicate_input(request: ResponsesAgentRequest, session: AsyncDatabricksSession) -> list[dict]:
    """Return the input messages to pass to the Runner, avoiding duplication with session history.

    When a client sends the full conversation history AND the session already has
    that history persisted, passing everything through would duplicate messages.
    If the session already covers the prior turns, only the latest message is needed
    since the session will prepend the full history automatically.

    Also sanitizes the session (dedupes duplicate items and injects synthetic
    outputs for orphan tool_calls left behind by a durable-resume interrupt)
    so the next LLM request over this session is a valid conversation.
    """
    await _sanitize_session(session)
    messages = [i.model_dump() for i in request.input]
    # Empty input is a valid signal from the long-running server to resume an
    # existing session without re-sending user content — the session already
    # has the prior turns, so there is nothing to deduplicate.
    if not messages:
        return []
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
