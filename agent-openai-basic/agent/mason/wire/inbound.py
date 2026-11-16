"""Inbound wire translation: Responses request -> agent-SDK run input.

Extracts the session id and turns ``request.input`` into the message list handed to
``Runner.run`` (deduped against session history, content normalized)."""

from agents.memory.session import SessionABC
from mlflow.types.responses import ResponsesAgentRequest
from uuid_utils import uuid7


def get_session_id(request: ResponsesAgentRequest) -> str:
    """Extract session_id from request or generate a new one."""
    # Priority:
    # 1. Use session_id from custom_inputs
    # 2. Use conversation_id from ChatContext
    #    https://mlflow.org/docs/latest/api_reference/python_api/mlflow.types.html#mlflow.types.agent.ChatContext
    # 3. Generate a new UUID
    ci = dict(request.custom_inputs or {})

    if ci.get("session_id"):
        return str(ci["session_id"])

    if request.context and getattr(request.context, "conversation_id", None):
        return str(request.context.conversation_id)

    return str(uuid7())


async def deduplicate_input(request: ResponsesAgentRequest, session: SessionABC) -> list[dict]:
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
