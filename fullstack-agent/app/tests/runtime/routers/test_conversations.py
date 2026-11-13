"""Create, list, open, rename and delete conversations; only the caller's."""

import pytest
from databricks_agentkit.runtime.store import InMemoryRuntimeStore
from databricks_agentkit.runtime.types import (
    Invocation,
    InvocationEvent,
    InvocationStatus,
)

from runtime import schemas
from tests.conftest import (
    OTHER_USER,
    SESSIONS_PATH,
    USER,
    FakeSessionStore,
    headers_for,
    store_session_id,
)

QUESTION = {"messages": [{"role": "user", "content": "What are my records?"}]}


def test_a_new_conversation_uses_the_runtime_session_id_and_the_forwarded_email(
    deployed, client
):
    headers = headers_for(USER)

    response = client.post(
        "/api/sessions",
        headers=headers,
        json={"title": "Records", "actor_id": OTHER_USER},
    )

    created = response.json()
    assert (response.status_code, created["title"]) == (201, "Records")
    session = deployed.sessions[store_session_id(headers, created["id"])]
    assert session["actor_id"] == USER
    assert session["metadata"] == {
        "conversation_id": created["id"],
        "title": "Records",
    }


def test_the_list_holds_only_the_callers_conversations(deployed, client):
    mine = client.post(
        "/api/sessions", headers=headers_for(USER), json={"title": "Mine"}
    ).json()
    client.post(
        "/api/sessions", headers=headers_for(OTHER_USER), json={"title": "Theirs"}
    )
    deployed.sessions["runtime-only"] = {
        "session_id": "runtime-only",
        "actor_id": USER,
        "metadata": {"client": "agentbricks-openai-agent"},
    }
    deployed.sessions["local-run"] = {
        "session_id": "local-run",
        "actor_id": USER,
        "metadata": {"conversation_id": "from-a-local-run", "title": "Local"},
    }

    response = client.get("/api/sessions", headers=headers_for(USER))

    assert [(item["id"], item["title"]) for item in response.json()] == [
        (mine["id"], "Mine")
    ]
    method, path, query, _ = deployed.calls[-1]
    assert (method, path) == ("GET", SESSIONS_PATH)
    assert query["filter"] == f'actor_id = "{USER}"'


def assistant(text: str) -> dict:
    """An assistant message as the Agents SDK stores it."""
    return {
        "type": "message",
        "role": "assistant",
        "content": [{"type": "output_text", "text": text}],
    }


def test_a_conversation_returns_its_questions_and_answers_without_working_text(
    deployed, client
):
    headers = headers_for(USER)
    created = client.post("/api/sessions", headers=headers, json={"title": "Records"})
    conversation_id = created.json()["id"]
    deployed.items[store_session_id(headers, conversation_id)] = [
        {"role": "user", "content": "What are my records?"},
        assistant("I'll check your records, as my instructions say."),
        {"type": "function_call", "name": "read_records", "arguments": "{}"},
        {"type": "function_call_output", "output": "[]"},
        {"type": "function_call", "name": "read_reference", "arguments": "{}"},
        assistant("Now the reference data."),
        {"type": "function_call_output", "output": "[]"},
        assistant("You have 3 records."),
        {"role": "user", "content": "Rename my first record to Archive."},
        {"type": "function_call", "name": "propose_rename", "arguments": "{}"},
        {"type": "function_call_output", "output": "Nothing has changed yet."},
        assistant("Please confirm the new name on the card."),
        {"role": "user", "content": "I confirmed this change."},
        {
            "role": "assistant",
            "content": "Record renamed. Your reference is REF-1.",
        },
    ]

    response = client.get(f"/api/sessions/{conversation_id}", headers=headers)

    assert response.json() == {
        "id": conversation_id,
        "title": "Records",
        "messages": [
            {"role": "user", "content": "What are my records?"},
            {"role": "assistant", "content": "You have 3 records."},
            {"role": "user", "content": "Rename my first record to Archive."},
            {
                "role": "assistant",
                "content": "Please confirm the new name on the card.",
            },
            {"role": "user", "content": "I confirmed this change."},
            {
                "role": "assistant",
                "content": "Record renamed. Your reference is REF-1.",
            },
        ],
        "runs": [],
        "running": None,
    }


def test_another_user_cannot_open_a_conversation(deployed, client):
    conversation_id = client.post(
        "/api/sessions", headers=headers_for(USER), json={"title": "Mine"}
    ).json()["id"]

    response = client.get(
        f"/api/sessions/{conversation_id}", headers=headers_for(OTHER_USER)
    )

    assert response.status_code == 404


def test_a_session_of_another_actor_is_not_returned(deployed, client):
    headers = headers_for(USER)
    session_id = store_session_id(headers, "shared-id")
    deployed.sessions[session_id] = {
        "session_id": session_id,
        "actor_id": OTHER_USER,
        "metadata": {"conversation_id": "shared-id"},
    }

    response = client.get("/api/sessions/shared-id", headers=headers)

    assert response.status_code == 404


def stored_conversation(store: FakeSessionStore, email: str) -> str:
    """Store a conversation of `email` as "conv-1" and return its runtime session ID."""
    session_id = store_session_id(headers_for(email), "conv-1")
    store.sessions[session_id] = {
        "session_id": session_id,
        "actor_id": email,
        "metadata": {"conversation_id": "conv-1", "title": "Records"},
    }
    return session_id


def invocation(
    session_id: str,
    status: InvocationStatus,
    public_id: str,
    sequence: int,
    run_input: dict = QUESTION,
) -> Invocation:
    """A runtime invocation the client sent as `public_id`."""
    return Invocation(
        invocation_id=f"runtime:{public_id}",
        status=status,
        attempt=1 if status == InvocationStatus.ACTIVE else 0,
        request={"input": run_input, "invocation_id": public_id},
        response=None,
        session_id=session_id,
        session_sequence_number=sequence,
    )


def add_invocations(store: InMemoryRuntimeStore, *invocations: Invocation) -> None:
    for state in invocations:
        store.states[state.invocation_id] = state


def add_events(store: InMemoryRuntimeStore, state: Invocation, *events: dict) -> None:
    for event in events:
        store.persisted_events.append(
            InvocationEvent(
                sequence_number=len(store.persisted_events) + 1,
                invocation_id=state.invocation_id,
                attempt=1,
                event=event,
            )
        )


def test_a_conversation_returns_each_run_with_its_input_and_events_oldest_first(
    deployed, client, runtime_store
):
    session_id = stored_conversation(deployed, USER)
    decision = {"confirm": {"proposal_id": "p-1", "decision": "approve"}}
    asked = invocation(session_id, InvocationStatus.COMPLETED, "asked", 1)
    decided = invocation(session_id, InvocationStatus.FAILED, "decided", 2, decision)
    add_invocations(runtime_store, decided, asked)
    add_events(
        runtime_store,
        asked,
        {"type": "run.started"},
        {"type": "delta", "content": "You have"},
        {"type": "run.completed"},
    )
    add_events(runtime_store, decided, {"type": "run.started"}, {"type": "run.failed"})

    response = client.get("/api/sessions/conv-1", headers=headers_for(USER))

    assert response.json()["runs"] == [
        {
            "id": "asked",
            "input": QUESTION,
            "events": [
                {"id": 1, "type": "run.started", "data": {"type": "run.started"}},
                {
                    "id": 2,
                    "type": "delta",
                    "data": {"type": "delta", "content": "You have"},
                },
                {"id": 3, "type": "run.completed", "data": {"type": "run.completed"}},
            ],
        },
        {
            "id": "decided",
            "input": decision,
            "events": [
                {"id": 4, "type": "run.started", "data": {"type": "run.started"}},
                {"id": 5, "type": "run.failed", "data": {"type": "run.failed"}},
            ],
        },
    ]


def test_a_queued_run_comes_last_without_events(deployed, client, runtime_store):
    session_id = stored_conversation(deployed, USER)
    done = invocation(session_id, InvocationStatus.COMPLETED, "done", 1)
    add_invocations(
        runtime_store, done, invocation(session_id, InvocationStatus.QUEUED, "next", 2)
    )
    add_events(runtime_store, done, {"type": "run.started"}, {"type": "run.completed"})

    response = client.get("/api/sessions/conv-1", headers=headers_for(USER))

    runs = response.json()["runs"]
    assert [(run["id"], run["input"], len(run["events"])) for run in runs] == [
        ("done", QUESTION, 2),
        ("next", QUESTION, 0),
    ]


def test_a_conversation_names_its_running_invocation_for_a_replay(
    deployed, client, runtime_store
):
    session_id = stored_conversation(deployed, USER)
    add_invocations(
        runtime_store,
        invocation(session_id, InvocationStatus.COMPLETED, "done", 1),
        invocation(session_id, InvocationStatus.ACTIVE, "running", 2),
        invocation(session_id, InvocationStatus.QUEUED, "next", 3),
    )

    response = client.get("/api/sessions/conv-1", headers=headers_for(USER))

    assert response.json()["running"] == {"id": "running", "status": "active"}


def test_a_queued_invocation_is_named_when_none_is_running(
    deployed, client, runtime_store
):
    session_id = stored_conversation(deployed, USER)
    add_invocations(
        runtime_store,
        invocation(session_id, InvocationStatus.FAILED, "failed", 1),
        invocation(session_id, InvocationStatus.QUEUED, "next", 2),
    )

    response = client.get("/api/sessions/conv-1", headers=headers_for(USER))

    assert response.json()["running"] == {"id": "next", "status": "queued"}


def test_a_finished_conversation_has_nothing_running(deployed, client, runtime_store):
    session_id = stored_conversation(deployed, USER)
    add_invocations(
        runtime_store, invocation(session_id, InvocationStatus.COMPLETED, "done", 1)
    )

    response = client.get("/api/sessions/conv-1", headers=headers_for(USER))

    assert response.json()["running"] is None


def test_a_reopened_conversation_shows_its_open_card_from_the_stored_events(
    deployed, client, runtime_store
):
    session_id = stored_conversation(deployed, USER)
    rename = {"record_id": "R-1", "name": "Archive", "amount": "4.50"}
    card = {
        "type": "confirmation_required",
        "proposal_id": "p-1",
        "action": "rename_record",
        "args": {"current_name": "Drafts"} | rename,
        "arguments": rename,
    }
    asked = invocation(session_id, InvocationStatus.COMPLETED, "asked", 1)
    add_invocations(runtime_store, asked)
    add_events(runtime_store, asked, card)

    response = client.get("/api/sessions/conv-1", headers=headers_for(USER))

    conversation = response.json()
    assert "proposals" not in conversation
    assert conversation["runs"][0]["events"] == [
        {"id": 1, "type": "confirmation_required", "data": card}
    ]


def test_another_users_runs_and_cards_never_show(deployed, client, runtime_store):
    theirs = stored_conversation(deployed, OTHER_USER)
    stored_conversation(deployed, USER)
    their_run = invocation(theirs, InvocationStatus.ACTIVE, "theirs", 1)
    add_invocations(runtime_store, their_run)
    theirs = {"name": "Theirs"}
    add_events(
        runtime_store,
        their_run,
        {"type": "run.started"},
        {
            "type": "confirmation_required",
            "proposal_id": "theirs",
            "action": "rename_record",
            "args": theirs,
            "arguments": theirs,
        },
    )

    response = client.get("/api/sessions/conv-1", headers=headers_for(USER))

    conversation = response.json()
    assert (conversation["runs"], conversation["running"]) == ([], None)


@pytest.mark.parametrize("method", ["POST", "PATCH"])
@pytest.mark.parametrize("title", ["", "   ", "x" * (schemas.TITLE_MAX_LENGTH + 1)])
def test_a_conversation_title_must_be_short_and_present(
    deployed, client, method, title
):
    path = "/api/sessions" if method == "POST" else "/api/sessions/conv-1"

    response = client.request(
        method, path, headers=headers_for(USER), json={"title": title}
    )

    assert response.status_code == 422
    assert deployed.calls == []


def test_a_rename_keeps_the_conversation_id(deployed, client):
    session_id = stored_conversation(deployed, USER)
    deployed.sessions[session_id]["last_activity_time"] = "2026-10-12T09:00:00Z"

    response = client.patch(
        "/api/sessions/conv-1",
        headers=headers_for(USER),
        json={"title": "  Saved drafts  "},
    )

    assert response.json() == {
        "id": "conv-1",
        "title": "Saved drafts",
        "last_activity_time": "2026-10-12T09:00:00Z",
    }
    assert deployed.sessions[session_id]["metadata"] == {
        "conversation_id": "conv-1",
        "title": "Saved drafts",
    }
    method, path, query, _ = deployed.calls[-1]
    assert (method, path, query) == (
        "PATCH",
        f"{SESSIONS_PATH}/{session_id}",
        {"update_mask": "metadata"},
    )


def test_a_deleted_conversation_is_gone(deployed, client):
    session_id = stored_conversation(deployed, USER)
    headers = headers_for(USER)

    response = client.delete("/api/sessions/conv-1", headers=headers)

    assert (response.status_code, response.content) == (204, b"")
    assert deployed.calls[-1] == ("DELETE", f"{SESSIONS_PATH}/{session_id}", None, None)
    assert client.get("/api/sessions/conv-1", headers=headers).status_code == 404


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
def test_a_missing_or_another_users_conversation_is_not_found(deployed, client, method):
    headers = headers_for(USER)
    stored_conversation(deployed, OTHER_USER)
    shared = store_session_id(headers, "shared-id")
    deployed.sessions[shared] = {
        "session_id": shared,
        "actor_id": OTHER_USER,
        "metadata": {"conversation_id": "shared-id", "title": "Theirs"},
    }

    for conversation_id in ("gone", "conv-1", "shared-id"):
        response = client.request(
            method,
            f"/api/sessions/{conversation_id}",
            headers=headers,
            json={"title": "Mine now"},
        )
        assert response.status_code == 404

    assert [call[0] for call in deployed.calls] == ["GET", "GET", "GET"]


@pytest.mark.parametrize("status", [InvocationStatus.ACTIVE, InvocationStatus.QUEUED])
def test_a_conversation_with_an_unfinished_run_is_not_deleted(
    deployed, client, runtime_store, status
):
    session_id = stored_conversation(deployed, USER)
    add_invocations(runtime_store, invocation(session_id, status, "unfinished", 1))

    response = client.delete("/api/sessions/conv-1", headers=headers_for(USER))

    assert response.status_code == 409
    assert session_id in deployed.sessions
