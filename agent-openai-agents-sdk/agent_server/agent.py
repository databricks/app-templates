import logging
import os

import mlflow
from databricks.sdk import WorkspaceClient
from databricks_openai import DatabricksOpenAI
from fastapi import HTTPException
from mlflow import MlflowClient
from mlflow.genai.agent_server import get_request_headers, invoke, stream
from mlflow.tracing import get_tracing_context_headers_for_http_request
from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentResponse

from agent_server.utils import get_session_id, get_user_workspace_client

mlflow.openai.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

# Supervisor (MAS) API: Databricks runs the tool-selection + synthesis loop server-side.
MODEL = "databricks-claude-sonnet-4"

# UC memory store the memory_store MCP tool reads/writes (full catalog.schema.name).
MEMORY_STORE = os.environ.get("DATABRICKS_MEMORY_STORE")
# DEV-ONLY: pre-GA liteswap routing header for the MAS / memory MCP. Remove at GA.
_MEMORY_TRAFFIC_ID = os.environ.get("DATABRICKS_MEMORY_TRAFFIC_ID")

def resolve_scope(request=None) -> str | None:
    """End-user id used as the memory `scope` — the partition the memory_store tool reads/writes.
    Deployed: the verified OBO forwarded token -> current_user.me().id (the only trusted source).
    Local: an X-Forwarded-User header or custom_inputs.user_id. None (fail closed) otherwise."""
    headers = get_request_headers() or {}
    if headers.get("x-forwarded-access-token"):
        return get_user_workspace_client().current_user.me().id
    # Deployed -> only the verified OBO token is trusted; client-supplied ids below are LOCAL-DEV only.
    if os.getenv("DATABRICKS_APP_NAME"):
        return None
    ci = dict(getattr(request, "custom_inputs", None) or {})
    # DATABRICKS_MEMORY_DEV_SCOPE is a LOCAL-ONLY fallback so the chat UI is playable when it sends
    # no user_id; it's unreachable when deployed (the DATABRICKS_APP_NAME gate above returns first).
    return headers.get("x-forwarded-user") or ci.get("user_id") or os.getenv("DATABRICKS_MEMORY_DEV_SCOPE")


def _get_trace_destination() -> dict | None:
    """Resolve the UC trace destination from the experiment, or None if unavailable (tracing skipped)."""
    experiment_id = os.environ.get("MLFLOW_EXPERIMENT_ID")
    if not experiment_id:
        return None
    try:
        trace_location = MlflowClient().get_experiment(experiment_id).trace_location
        if trace_location is None or not hasattr(trace_location, "catalog_name"):
            return None
        dest = {"catalog_name": trace_location.catalog_name, "schema_name": trace_location.schema_name}
        if trace_location.table_prefix is not None:
            dest["table_prefix"] = trace_location.table_prefix
        return dest
    except Exception:
        logger.warning("Could not resolve trace destination, distributed tracing disabled.", exc_info=True)
        return None


_TRACE_DESTINATION = _get_trace_destination()


def _extra_body() -> dict:
    return {"trace_destination": _TRACE_DESTINATION} if _TRACE_DESTINATION else {}


def _client() -> DatabricksOpenAI:
    """Supervisor (MAS) client, pointed at the MAS endpoint with the dev-only liteswap header so the
    pre-GA memory_store MCP tool resolves. SP auth: WorkspaceClient() = app SP deployed / dev profile locally."""
    w = WorkspaceClient()
    headers = {"x-databricks-traffic-id": _MEMORY_TRAFFIC_ID} if _MEMORY_TRAFFIC_ID else None
    return DatabricksOpenAI(
        workspace_client=w,
        base_url=f"{w.config.host.rstrip('/')}/api/2.0/mas",
        default_headers=headers,
    )


@invoke()
def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    scope = resolve_scope(request)
    if not scope:
        raise HTTPException(status_code=401, detail="No end-user scope — refusing memory access.")
    response = _client().responses.create(
        model=MODEL,
        input=[i.model_dump() for i in request.input],
        tools=[{"type": "memory_store", "memory_store": {"name": MEMORY_STORE, "scope": scope}}],
        tool_choice="auto",
        parallel_tool_calls=False,
        stream=False,
        extra_headers=get_tracing_context_headers_for_http_request(),
        extra_body=_extra_body(),
    )
    return ResponsesAgentResponse(output=[item.model_dump() for item in response.output])


@stream()
def stream_handler(request: ResponsesAgentRequest):
    if session_id := get_session_id(request):
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
    scope = resolve_scope(request)
    if not scope:
        raise HTTPException(status_code=401, detail="No end-user scope — refusing memory access.")
    return _client().responses.create(
        model=MODEL,
        input=[i.model_dump() for i in request.input],
        tools=[{"type": "memory_store", "memory_store": {"name": MEMORY_STORE, "scope": scope}}],
        tool_choice="auto",
        parallel_tool_calls=False,
        stream=True,
        extra_headers=get_tracing_context_headers_for_http_request(),
        extra_body=_extra_body(),
    )
