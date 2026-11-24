"""Caller's conversations in session store, runs in runtime store.
App client accesses both; sessions have runtime-derived ID and caller's email."""

import asyncio
import itertools
import json
import os
import uuid
from collections.abc import Iterable
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound
from databricks.sdk.service.agentkit import FieldMask, Session
from databricks_agentkit.runtime.types import Invocation
from fastapi import FastAPI, HTTPException
from google.protobuf.timestamp_pb2 import Timestamp

from runtime.auth import Caller

SESSIONS_PAGE_SIZE = 50
NOT_FOUND = "Conversation not found."
TOOL_ITEMS = ("function_call", "function_call_output")


def store_name() -> str:
    """The session store name from AGENT_SESSION_STORE (same as runtime's source)."""
    store = os.getenv("AGENT_SESSION_STORE")
    if not store:
        raise HTTPException(
            503, "No session store is configured. Set AGENT_SESSION_STORE."
        )
    return store


def session_store_parent() -> str:
    """The parent path for session store operations."""
    return f"session-stores/{store_name()}"


def session_name(session_id: str) -> str:
    """The resource name for a session."""
    return f"{session_store_parent()}/sessions/{session_id}"


def timestamp_string(ts: Timestamp | None) -> str | None:
    """Convert Timestamp to ISO string (ToJsonString()) or None."""
    return ts.ToJsonString() if ts else None


def create(caller: "Caller", title: str) -> dict[str, str]:
    """Create a conversation; session uses runtime-derived ID for first turn."""
    conversation_id = str(uuid.uuid4())
    session_id = caller.store_session_id(conversation_id)
    caller.client_for("app").agent_kit.create_session(
        parent=session_store_parent(),
        session=Session(
            actor_id=caller.email,
            metadata={"conversation_id": conversation_id, "title": title},
        ),
        session_id=session_id,
    )
    return {"id": conversation_id, "title": title}


def listed(caller: "Caller") -> list[dict[str, str | None]]:
    """List caller's conversations newest first; only those this app can open."""
    result = []
    for session in itertools.islice(
        caller.client_for("app").agent_kit.list_sessions(
            parent=session_store_parent(),
            filter=f"actor_id = {json.dumps(caller.email)}",
            order_by="last_activity_time desc",
            page_size=SESSIONS_PAGE_SIZE,
        ),
        SESSIONS_PAGE_SIZE,
    ):
        if (
            session.actor_id == caller.email
            and session.metadata
            and "conversation_id" in session.metadata
            and session.session_id
            == caller.store_session_id(session.metadata["conversation_id"])
        ):
            result.append(
                {
                    "id": session.metadata["conversation_id"],
                    "title": session.metadata.get("title"),
                    "last_activity_time": timestamp_string(session.last_activity_time),
                }
            )
    return result


def owned(caller: "Caller", conversation_id: str) -> Session:
    """The caller's session for a conversation, or 404 as for a missing one."""
    session_id = caller.store_session_id(conversation_id)
    try:
        session = caller.client_for("app").agent_kit.get_session(
            name=session_name(session_id)
        )
    except NotFound as error:
        raise HTTPException(404, NOT_FOUND) from error
    if session.actor_id != caller.email:
        raise HTTPException(404, NOT_FOUND)
    return session


def transcript(caller: "Caller", conversation_id: str) -> dict[str, Any]:
    """One of the caller's conversations as user and assistant messages."""
    session = owned(caller, conversation_id)
    items = caller.client_for("app").agent_kit.list_session_items(
        parent=session_name(session.session_id), order_by="create_time asc"
    )
    return {
        "id": conversation_id,
        "title": session.metadata.get("title") if session.metadata else None,
        "messages": chat_messages(item.data for item in items),
    }


def rename(caller: "Caller", conversation_id: str, title: str) -> dict[str, str | None]:
    """Rename a conversation; merge title into metadata, preserving conversation_id."""
    session = owned(caller, conversation_id)
    updated_metadata = (session.metadata or {}) | {"title": title}
    updated = caller.client_for("app").agent_kit.update_session(
        name=session_name(session.session_id),
        session=Session(
            actor_id=session.actor_id,
            metadata=updated_metadata,
        ),
        update_mask=FieldMask(field_mask=["metadata"]),
    )
    return {
        "id": conversation_id,
        "title": updated.metadata.get("title") if updated.metadata else None,
        "last_activity_time": timestamp_string(updated.last_activity_time),
    }


def delete(caller: "Caller", session: Session) -> None:
    """Delete an owned session and its items for good."""
    caller.client_for("app").agent_kit.delete_session(
        name=session_name(session.session_id)
    )


def drop_last_turn(client: WorkspaceClient, session_id: str) -> int:
    """Pop the last turn's items one by one; a failure leaves the turn's start."""
    parent = session_name(session_id)
    items = [
        item.data
        for item in client.agent_kit.list_session_items(
            parent=parent, order_by="create_time asc"
        )
    ]
    questions = [
        index
        for index, item in enumerate(items)
        if isinstance(item, dict) and item.get("role") == "user"
    ]
    if not questions:
        return 0
    count = len(items) - questions[-1]
    for _ in range(count):
        client.agent_kit.pop_session_item(parent=parent)
    return count


def chat_messages(items: Iterable[Any]) -> list[dict[str, str]]:
    """Extract user messages and turn answers from transcript; drop narration."""
    messages: list[dict[str, str]] = []
    answers: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("type") in TOOL_ITEMS:
            answers = []
        elif item.get("role") == "user" and (content := text_of(item)):
            messages += answers
            answers = []
            messages.append({"role": "user", "content": content})
        elif item.get("role") == "assistant" and (content := text_of(item)):
            answers.append({"role": "assistant", "content": content})
    return messages + answers


def text_of(item: dict) -> str:
    content = item.get("content")
    if isinstance(content, list):
        content = "".join(
            str(part.get("text", "")) for part in content if isinstance(part, dict)
        )
    return str(content) if content else ""


def get_session_runtime(app: FastAPI) -> Any:
    """The app's session runtime, held for the lifetime of the app process."""
    return app._runtime


async def stored_events(app: FastAPI, session_id: str) -> list[dict[str, Any]]:
    """Return session's run events from runtime's private store, oldest first."""
    runtime = get_session_runtime(app)
    return [stored.event for stored in await runtime.get_events(session_id=session_id)]


async def running_invocation(app: FastAPI, session_id: str) -> dict[str, str] | None:
    """Return session's active or queued run, or None if finished."""
    state = await get_session_runtime(app).get_invocation(session_id=session_id)
    if state is None:
        return None
    return {"id": client_id(state), "status": state.status.value.lower()}


async def session_runs(app: FastAPI, session_id: str) -> list[dict[str, Any]]:
    """Return session's runs with input and events, oldest first."""
    runtime = get_session_runtime(app)
    events: dict[str, list[dict[str, Any]]] = {}
    for stored in await runtime.get_events(session_id=session_id):
        events.setdefault(stored.invocation_id, []).append(
            {
                "id": stored.sequence_number,
                "type": stored.event.get("type", "message"),
                "data": stored.event,
            }
        )
    states = await asyncio.gather(*map(runtime.get_invocation, events))
    unfinished = await runtime.get_invocation(session_id=session_id)
    if unfinished is not None and unfinished.invocation_id not in events:
        states.append(unfinished)
    return [
        {
            "id": client_id(state),
            "input": state.request.get("input"),
            "events": events.get(state.invocation_id, []),
        }
        for state in states
        if state is not None
    ]


async def run_trace_id(app: FastAPI, session_id: str, run_id: str) -> str | None:
    """The trace ID the session's run `run_id` sent in its `trace` event, or None."""
    for run in await session_runs(app, session_id):
        if run["id"] == run_id:
            traces = [event for event in run["events"] if event["type"] == "trace"]
            return traces[0]["data"]["trace_id"] if traces else None
    return None


def client_id(state: Invocation) -> str:
    """The run's ID as the client sent it, which the client replays it by."""
    return state.request.get("invocation_id", state.invocation_id)
