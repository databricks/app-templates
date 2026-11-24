"""Stop only your own run, and only one this instance runs."""

from agent import cancellation
from agent.cancellation import stop_run
from tests.conftest import (
    OTHER_USER,
    USER,
    headers_for,
    store_session_id,
)


class StreamingRun:
    def __init__(self):
        self.cancelled: list[str] = []

    def cancel(self, mode: str) -> None:
        self.cancelled.append(mode)


def test_stop_ends_the_callers_run_after_its_turn(deployed, client, monkeypatch):
    headers = headers_for(USER)
    run = StreamingRun()
    key = (store_session_id(headers, "c-1"), "run-1")
    monkeypatch.setitem(cancellation.RUNNING, key, run)

    response = client.post(
        "/api/invocations/run-1/cancel", json={"session_id": "c-1"}, headers=headers
    )

    assert response.json() == {"stopped": True}
    assert run.cancelled == ["after_turn"]


def test_another_user_cannot_stop_a_run(deployed, client, monkeypatch):
    run = StreamingRun()
    key = (store_session_id(headers_for(USER), "c-1"), "run-1")
    monkeypatch.setitem(cancellation.RUNNING, key, run)

    response = client.post(
        "/api/invocations/run-1/cancel",
        json={"session_id": "c-1"},
        headers=headers_for(OTHER_USER),
    )

    assert response.json() == {"stopped": False}
    assert run.cancelled == []


def test_stopping_a_run_this_instance_doesnt_run_changes_nothing(deployed, client):
    response = client.post(
        "/api/invocations/run-9/cancel",
        json={"session_id": "c-1"},
        headers=headers_for(USER),
    )

    assert response.json() == {"stopped": False}


def test_only_a_running_run_of_that_session_can_be_stopped():
    assert stop_run("session-a", "run-1") is False
    assert stop_run("session-b", "run-1") is False
