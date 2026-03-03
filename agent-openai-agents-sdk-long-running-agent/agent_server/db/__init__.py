"""Database layer for long-running agent persistence (Lakebase)."""

from agent_server.db.models import Message, Response
from agent_server.db.connection import (
    dispose_db,
    get_async_session,
    init_db,
    is_db_configured,
)
from agent_server.db.repository import (
    append_message,
    create_response,
    get_messages,
    get_response,
    update_response_status,
    update_response_trace_id,
)

__all__ = [
    "Message",
    "Response",
    "append_message",
    "create_response",
    "dispose_db",
    "get_async_session",
    "get_messages",
    "get_response",
    "init_db",
    "is_db_configured",
    "update_response_status",
    "update_response_trace_id",
]
