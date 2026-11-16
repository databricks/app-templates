"""Conversation session store for the agent.

LangGraph persists conversation state through a **checkpointer** keyed by a ``thread_id`` (passed in
the run config), not through a session object. ``checkpointer()`` returns the checkpointer the agent
is built with, and ``thread_config(session_id)`` maps a session id onto that thread.

Default: an in-memory checkpointer (``InMemorySaver``) — multi-turn history is preserved within a
single running process, no database. It does NOT survive restarts or span replicas; for that, swap
in a durable checkpointer (e.g. ``langgraph.checkpoint.postgres.PostgresSaver`` over the Lakebase
attached as the ``postgres`` app resource). That swap is the one edit needed here; nothing else in
the agent changes.
"""

from functools import lru_cache

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver


@lru_cache(maxsize=1)
def checkpointer() -> BaseCheckpointSaver:
    """The checkpointer the agent persists conversation state to. In-memory by default.

    Cached so every request shares one saver (that's what makes multi-turn work in-process). To make
    history durable + shared across replicas, return a ``PostgresSaver`` built from the Lakebase
    endpoint instead.
    """
    return InMemorySaver()


def thread_config(session_id: str) -> dict:
    """Run config that anchors this request to ``session_id``'s conversation thread."""
    return {"configurable": {"thread_id": session_id}}
