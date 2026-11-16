"""Inbound wire translation: Responses request -> LangGraph run input.

Extracts the session id (used as the LangGraph ``thread_id``). Message conversion itself is done in
the handler via MLflow's ``to_chat_completions_input``; this module only resolves the session id.
"""

from mlflow.types.responses import ResponsesAgentRequest
from uuid_utils import uuid7


def get_session_id(request: ResponsesAgentRequest) -> str:
    """Extract session_id from the request or generate a new one."""
    # Priority:
    # 1. session_id from custom_inputs
    # 2. conversation_id from ChatContext
    # 3. a new UUID
    ci = dict(request.custom_inputs or {})
    if ci.get("session_id"):
        return str(ci["session_id"])
    if request.context and getattr(request.context, "conversation_id", None):
        return str(request.context.conversation_id)
    return str(uuid7())
