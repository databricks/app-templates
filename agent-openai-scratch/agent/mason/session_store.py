"""Conversation session store for the agent.

``create_session`` returns the session the agent injects into ``Runner.run(session=...)`` for
short-term history. Defaults to a local SQLite file (no database, runs anywhere). When
``AGENT_SESSION_STORE`` names a Databricks managed session store, it returns a session backed by
that store's ``agents/v1`` items API instead, so history survives restarts and is shared across
replicas. Enable durability by setting ``AGENT_SESSION_STORE``; no code change.

The managed store is provisioned/inspected out of band (e.g. the ``databricks agent`` CLI, or the
``agents/v1`` API). This module only reads/writes conversation items for a given session id.
"""

import os

from agents.memory.session import SessionABC
from agents.memory.sqlite_session import SQLiteSession
from databricks.sdk import WorkspaceClient

# A file (not ":memory:") so local history is shared across requests and survives restarts.
_DEFAULT_LOCAL_SESSION_DB_PATH = "local_agent_sessions.db"
_AGENTS_V1 = "/api/agents/v1"


class DatabricksSessionStore(SessionABC):
    """OpenAI Agents SDK ``Session`` backed by a Databricks managed session store.

    Maps the SDK session protocol onto the ``agents/v1`` session-items API. ``pop_item`` and
    ``clear_session`` are no-ops: the server does not implement item removal.
    """

    def __init__(self, store: str, session_id: str):
        self.store = store
        self.session_id = session_id
        self._client = WorkspaceClient()

    def _path(self, suffix: str = "") -> str:
        return f"{_AGENTS_V1}/session-stores/{self.store}/sessions/{self.session_id}/items{suffix}"

    async def get_items(self, limit: int | None = None) -> list[dict]:
        resp = self._client.api_client.do(
            "GET", self._path(), query={"order_by": "create_time asc"}
        )
        return [item["data"] for item in resp.get("session_items", []) if "data" in item]

    async def add_items(self, items: list[dict]) -> None:
        if items:
            self._client.api_client.do(
                "POST", self._path(":append"), body={"items": list(items)}
            )

    async def pop_item(self) -> dict | None:
        return None  # server does not implement item removal

    async def clear_session(self) -> None:
        return None  # server does not implement item removal


def create_session(session_id: str) -> SessionABC:
    store = os.getenv("AGENT_SESSION_STORE")
    if store:
        return DatabricksSessionStore(store, session_id)
    db_path = os.getenv("LOCAL_SESSION_DB_PATH", _DEFAULT_LOCAL_SESSION_DB_PATH)
    return SQLiteSession(session_id, db_path)
