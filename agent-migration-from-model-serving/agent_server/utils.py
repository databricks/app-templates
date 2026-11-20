import json
import logging
from typing import Optional

from databricks.sdk import WorkspaceClient
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import ResponsesAgentRequest

# Clients resend the whole conversation in ``input``, so the conversation is bounded only
# by the body limits in security.py; a per-item or item-count cap would reject every
# later request in a thread once it was reached.
MAX_CUSTOM_INPUTS_CHARS = 10_000


def check_request_limits(body: dict) -> None:
    """Raise ``ValueError`` if a POST /invocations or /responses body is over the input limits."""
    try:
        request = ResponsesAgentRequest(**body)
    except Exception:
        # AgentServer rejects bodies that aren't a valid request with its own 400.
        return
    if len(json.dumps(request.custom_inputs or {}, default=str)) > MAX_CUSTOM_INPUTS_CHARS:
        raise ValueError(f"custom_inputs too large (limit {MAX_CUSTOM_INPUTS_CHARS} characters).")


def get_session_id(request: ResponsesAgentRequest) -> str | None:
    if request.context and request.context.conversation_id:
        return request.context.conversation_id
    if request.custom_inputs and isinstance(request.custom_inputs, dict):
        return request.custom_inputs.get("session_id")
    return None


def get_user_workspace_client() -> WorkspaceClient:
    token = get_request_headers().get("x-forwarded-access-token")
    return WorkspaceClient(token=token, auth_type="pat")


def get_databricks_host_from_env() -> Optional[str]:
    try:
        w = WorkspaceClient()
        return w.config.host
    except Exception as e:
        logging.exception(f"Error getting databricks host from env: {e}")
        return None
