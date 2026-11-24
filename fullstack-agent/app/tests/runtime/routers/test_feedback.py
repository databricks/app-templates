"""Rate only your own runs, on the trace the server finds for them."""

import logging

import mlflow
import pytest
from databricks_agentkit.runtime.store import InMemoryRuntimeStore
from databricks_agentkit.runtime.types import (
    Invocation,
    InvocationEvent,
    InvocationStatus,
)
from mlflow.entities import AssessmentSource
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import PERMISSION_DENIED

from runtime.routers import feedback as feedback_routes
from tests.conftest import (
    OTHER_USER,
    USER,
    FakeSessionStore,
    headers_for,
    store_session_id,
)

COMMENT = "Too long. Missed my question"
RATING = {
    "conversation_id": "c-1",
    "run_id": "run-1",
    "helpful": False,
    "comment": COMMENT,
}


def stored_run(
    store: FakeSessionStore,
    runtime_store: InMemoryRuntimeStore,
    email: str,
    trace_id: str,
) -> None:
    """Store conversation "c-1" of `email`, whose run "run-1" sent `trace_id`."""
    session_id = store_session_id(headers_for(email), "c-1")
    store.sessions[session_id] = {
        "session_id": session_id,
        "actor_id": email,
        "metadata": {"conversation_id": "c-1", "title": "Records"},
    }
    runtime_store.states["runtime:run-1"] = Invocation(
        invocation_id="runtime:run-1",
        status=InvocationStatus.COMPLETED,
        attempt=0,
        request={"input": {}, "invocation_id": "run-1"},
        response=None,
        session_id=session_id,
        session_sequence_number=1,
    )
    for event in ({"type": "run.started"}, {"type": "trace", "trace_id": trace_id}):
        runtime_store.persisted_events.append(
            InvocationEvent(
                sequence_number=len(runtime_store.persisted_events) + 1,
                invocation_id="runtime:run-1",
                attempt=1,
                event=event,
            )
        )


@pytest.fixture
def trace_id() -> str:
    """A finished trace in the test store, as an answer leaves one."""
    with mlflow.start_span(name="answer") as span:
        span.set_outputs("You have 3 records.")
    mlflow.flush_trace_async_logging()
    return span.trace_id


def assessments(trace_id: str) -> list:
    return mlflow.get_trace(trace_id, flush=True).info.assessments


def test_the_callers_own_run_gets_their_rating_on_its_trace(
    deployed, client, runtime_store, trace_id, caplog
):
    stored_run(deployed, runtime_store, USER, trace_id)

    with caplog.at_level(logging.INFO, logger=feedback_routes.__name__):
        response = client.post("/api/feedback", json=RATING, headers=headers_for(USER))

    assert response.status_code == 204
    (rating,) = assessments(trace_id)
    assert (rating.name, rating.value, rating.rationale) == (
        "user_feedback",
        False,
        COMMENT,
    )
    assert (rating.source.source_type, rating.source.source_id) == ("HUMAN", USER)
    (record,) = caplog.records
    assert (record.getMessage(), record.helpful) == ("Feedback logged", False)
    assert COMMENT not in str(record.__dict__)
    assert USER not in str(record.__dict__)


def test_a_rating_without_a_comment_has_no_rationale(
    deployed, client, runtime_store, trace_id
):
    stored_run(deployed, runtime_store, USER, trace_id)

    response = client.post(
        "/api/feedback",
        json={"conversation_id": "c-1", "run_id": "run-1", "helpful": True},
        headers=headers_for(USER),
    )

    assert response.status_code == 204
    (rating,) = assessments(trace_id)
    assert (rating.value, rating.rationale) == (True, None)


def test_a_second_rating_overrides_the_first(deployed, client, runtime_store, trace_id):
    stored_run(deployed, runtime_store, USER, trace_id)
    client.post("/api/feedback", json=RATING, headers=headers_for(USER))

    response = client.post(
        "/api/feedback",
        json={"conversation_id": "c-1", "run_id": "run-1", "helpful": True},
        headers=headers_for(USER),
    )

    assert response.status_code == 204
    first, second = assessments(trace_id)
    assert (first.value, first.rationale, first.valid) == (False, COMMENT, False)
    assert (second.value, second.rationale, second.valid) == (True, None, True)
    assert (second.name, second.overrides) == ("user_feedback", first.assessment_id)
    assert second.source == first.source


def test_a_rating_overrides_only_the_callers_own(
    deployed, client, runtime_store, trace_id
):
    stored_run(deployed, runtime_store, USER, trace_id)
    reviewer = mlflow.log_feedback(
        trace_id=trace_id,
        name="user_feedback",
        value=True,
        source=AssessmentSource(source_type="HUMAN", source_id=OTHER_USER),
    )
    for helpful in (True, False):
        client.post(
            "/api/feedback",
            json=RATING | {"helpful": helpful},
            headers=headers_for(USER),
        )

    current = mlflow.get_trace(trace_id, flush=True).search_assessments("user_feedback")

    assert [(rating.source.source_id, rating.value) for rating in current] == [
        (OTHER_USER, True),
        (USER, False),
    ]
    assert current[0].assessment_id == reviewer.assessment_id


def test_another_users_conversation_is_not_found(
    deployed, client, runtime_store, trace_id
):
    stored_run(deployed, runtime_store, OTHER_USER, trace_id)

    response = client.post("/api/feedback", json=RATING, headers=headers_for(USER))

    assert response.status_code == 404
    assert assessments(trace_id) == []


def test_an_unknown_run_is_not_found(deployed, client, runtime_store, trace_id):
    stored_run(deployed, runtime_store, USER, trace_id)

    response = client.post(
        "/api/feedback", json=RATING | {"run_id": "run-9"}, headers=headers_for(USER)
    )

    assert response.status_code == 404
    assert response.json()["detail"] == feedback_routes.RUN_NOT_FOUND
    assert assessments(trace_id) == []


@pytest.mark.parametrize(
    "extra", [{"trace_id": "tr-theirs"}, {"source_id": OTHER_USER}, {"helpful": "no"}]
)
def test_the_client_cannot_name_the_trace_or_the_source(
    deployed, client, runtime_store, trace_id, extra
):
    stored_run(deployed, runtime_store, USER, trace_id)

    response = client.post(
        "/api/feedback", json=RATING | extra, headers=headers_for(USER)
    )

    assert response.status_code == 422
    assert assessments(trace_id) == []


def test_a_rating_without_a_user_token_is_refused(
    deployed, client, runtime_store, trace_id, recorder
):
    stored_run(deployed, runtime_store, USER, trace_id)

    response = client.post(
        "/api/feedback", json=RATING, headers={"X-Forwarded-Email": USER}
    )

    assert response.status_code == 401
    assert (recorder.modes, assessments(trace_id)) == ([], [])


def test_a_failed_write_answers_502_and_logs_only_its_code(
    deployed, client, runtime_store, trace_id, monkeypatch, caplog
):
    stored_run(deployed, runtime_store, USER, trace_id)

    def refuse(**_):
        raise MlflowException("no MODIFY on annotations", PERMISSION_DENIED)

    monkeypatch.setattr(feedback_routes.mlflow, "log_feedback", refuse)

    response = client.post("/api/feedback", json=RATING, headers=headers_for(USER))

    assert response.status_code == 502
    assert response.json()["detail"] == feedback_routes.NOT_RECORDED
    (record,) = [r for r in caplog.records if r.name == feedback_routes.__name__]
    assert (record.levelname, record.code) == ("ERROR", "PERMISSION_DENIED")
    assert "MODIFY" not in str(record.__dict__)
