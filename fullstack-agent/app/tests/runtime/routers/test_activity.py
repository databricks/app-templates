"""The user's Activity pages, read as the user, and failed reads."""

from agent.statement_execution import QueryFailed
from runtime import auth, stores
from runtime.routers import activity as activity_routes
from tests.conftest import (
    USER,
    headers_for,
)


def test_activity_is_read_as_the_user(deployed, client, monkeypatch):
    calls = []
    monkeypatch.setattr(stores, "listed", lambda caller: [])
    monkeypatch.setattr(
        activity_routes,
        "read_activity",
        lambda client, before: (
            calls.append((client.mode, before)) or {"rows": [], "next": None}
        ),
    )

    response = client.get(
        "/api/activity",
        params={"before": "2026-10-14T09:00:00Z|run:1"},
        headers=headers_for(USER),
    )

    assert response.json() == {"rows": [], "next": None}
    assert calls == [("user", "2026-10-14T09:00:00Z|run:1")]


def test_activity_rows_name_their_conversation_or_none_once_deleted(
    deployed, client, monkeypatch
):
    monkeypatch.setattr(auth.Caller, "store_session_id", lambda self, id: f"store:{id}")
    monkeypatch.setattr(
        stores, "listed", lambda caller: [{"id": "c-1", "title": "Archive"}]
    )
    monkeypatch.setattr(
        activity_routes,
        "read_activity",
        lambda client, before: {
            "rows": [
                {"activity_id": "r:1", "session_id": "store:c-1"},
                {"activity_id": "r:2", "session_id": "store:c-gone"},
            ],
            "next": None,
        },
    )

    response = client.get("/api/activity", headers=headers_for(USER))

    assert response.json()["rows"] == [
        {
            "activity_id": "r:1",
            "conversation_id": "c-1",
            "conversation_title": "Archive",
        },
        {"activity_id": "r:2", "conversation_id": None, "conversation_title": None},
    ]


def test_a_malformed_activity_cursor_is_refused(deployed, client):
    response = client.get(
        "/api/activity", params={"before": "run:1"}, headers=headers_for(USER)
    )

    assert response.status_code == 422
    assert "before must be the next cursor" in response.json()["detail"]


def test_a_refused_query_returns_403_with_the_unity_catalog_error(
    deployed, client, monkeypatch
):
    def refuse(client, before):
        raise QueryFailed("FAILED: [INSUFFICIENT_PERMISSIONS] no SELECT on records")

    monkeypatch.setattr(activity_routes, "read_activity", refuse)

    response = client.get("/api/activity", headers=headers_for(USER))

    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "PERMISSION_DENIED"
    assert "INSUFFICIENT_PERMISSIONS" not in str(error)


def test_a_timeout_query_returns_504_with_query_timeout_code(
    deployed, client, monkeypatch
):
    from databricks.sdk.service.sql import StatementState

    def timeout(client, before):
        raise QueryFailed(
            "CANCELED: Query cancelled at wait timeout", state=StatementState.CANCELED
        )

    monkeypatch.setattr(activity_routes, "read_activity", timeout)

    response = client.get("/api/activity", headers=headers_for(USER))

    assert response.status_code == 504
    error = response.json()["error"]
    assert error["code"] == "QUERY_TIMEOUT"
    assert "CANCELED" not in str(error)
