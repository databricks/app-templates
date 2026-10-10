"""Inbound request handling: pull the session id from the request.

The request body is a plain dict shaped like the OpenAI Responses API — ``input`` is a list of
``openai.types.responses`` input items (what ``Runner.run`` accepts), plus an optional top-level
``session_id`` for multi-turn. With a ``session_id`` the session supplies prior history, so send only
the new turn's message in ``input`` (sending the full transcript too would duplicate it).
"""

from uuid_utils import uuid7


def get_session_id(request: dict) -> str:
    """Return the request's ``session_id`` (for multi-turn), or a fresh UUID for a new conversation."""
    return str(request.get("session_id") or uuid7())
