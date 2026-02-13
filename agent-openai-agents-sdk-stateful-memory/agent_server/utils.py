import json
import logging
from typing import AsyncGenerator, AsyncIterator, Optional
from uuid import uuid4

from agents.result import StreamEvent
from databricks.sdk import WorkspaceClient
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import ResponsesAgentStreamEvent


def _is_lakebase_hostname(value: str) -> bool:
    """Check if the value looks like a Lakebase hostname rather than an instance name."""
    return ".database." in value and value.endswith(".com")


def resolve_lakebase_instance_name(
    instance_name: str, workspace_client: Optional[WorkspaceClient] = None
) -> str:
    """
    Resolve a Lakebase instance name from a hostname if needed.

    If the input is a hostname (e.g., from Databricks Apps valueFrom resolution),
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


def _sanitize_item(input_item: dict) -> dict:
    """Sanitize a single output item dict for Pydantic validation.

    MCP tool calls (e.g. Genie) can return items where the `output` field is
    a *list* of content objects instead of a plain string. MLflow's Pydantic
    models expect `output` to be a string, so this serialises any non-string
    values to JSON.

    TODO: Remove once https://github.com/mlflow/mlflow/pull/20777 is released.
    """
    if isinstance(input_item.get("output"), list):
        input_item["output"] = json.dumps(input_item["output"])
    return input_item


def sanitize_output_items(items) -> list[dict]:
    """Convert agent output items to dicts safe for ResponsesAgentResponse."""
    return [_sanitize_item(item.to_input_item()) for item in items]


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
                item=_sanitize_item(event.item.to_input_item()),
            )
