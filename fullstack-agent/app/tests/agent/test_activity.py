import json
import logging
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from agent import activity
from agent.statement_execution import QueryFailed
from tests.conftest import USER, request_for


@pytest.fixture
def statements(monkeypatch) -> SimpleNamespace:
    """Each statement the module runs, as (client mode, statement, parameters)."""
    runs = SimpleNamespace(calls=[], failures=[], rows=[])

    def run_query(client, statement, parameters):
        runs.calls.append((client.mode, statement, parameters))
        if runs.failures:
            raise runs.failures.pop(0)
        return runs.rows

    monkeypatch.setattr(activity, "run_query", run_query)
    return runs


async def a_run_with_events(recorder) -> SimpleNamespace:
    request = request_for("session-a", recorder)
    await request.tool_event("model", "user", "llm", "allowed")
    await request.tool_event("read_records", "user", "c.test_data.records", "allowed")
    await request.tool_event(
        "rename_record",
        "user",
        "c.test_ops.rename_record",
        "allowed",
        proposal_id="p-1",
        status="OK",
        reference="REF-1",
        acted_as=USER,
    )
    return request


async def test_a_tool_event_carries_the_server_time_and_its_activity_id(recorder):
    request = request_for("session-a", recorder)

    await request.tool_event("read_records", "user", "t", "allowed")

    (event,) = recorder.events
    at = datetime.fromisoformat(event["at"])
    assert at.tzinfo == UTC
    assert abs((datetime.now(UTC) - at).total_seconds()) < 5
    assert request.activity == [{**event, "activity_id": "run-1:1"}]


async def test_a_run_writes_its_rows_in_one_insert_as_the_app(recorder, statements):
    request = await a_run_with_events(recorder)

    await activity.record_activity(request)

    ((mode, statement, parameters),) = statements.calls
    assert mode == "app"
    assert statement.startswith("INSERT INTO test_ops.assistant_activity ")
    assert "MERGE" not in statement
    assert (
        parameters["owner_email"],
        parameters["session_id"],
        parameters["run_id"],
    ) == (USER, "session-a", "run-1")
    rows = json.loads(parameters["rows"])
    assert [(row["activity_id"], row["tool"]) for row in rows] == [
        ("run-1:2", "read_records"),
        ("run-1:3", "rename_record"),
    ]
    assert set(rows[1]) == set(activity.EVENT_FIELDS)
    assert (rows[1]["status"], rows[1]["reference"], rows[1]["proposal_id"]) == (
        "OK",
        "REF-1",
        "p-1",
    )


async def test_a_run_without_rows_writes_nothing(recorder, statements):
    request = request_for("session-a", recorder)
    await request.tool_event("model", "user", "llm", "allowed")

    await activity.record_activity(request)

    assert statements.calls == []


async def test_a_failed_write_is_tried_again_with_the_same_rows(recorder, statements):
    request = await a_run_with_events(recorder)
    statements.failures.append(QueryFailed("CANCELED: timed out"))

    await activity.record_activity(request)

    first, second = statements.calls
    assert first == second


async def test_a_write_that_fails_twice_logs_an_error_and_keeps_the_run(
    recorder, statements, caplog
):
    request = await a_run_with_events(recorder)
    statements.failures += [QueryFailed("FAILED: a"), QueryFailed("FAILED: b")]

    with caplog.at_level(logging.INFO, logger="agent"):
        await activity.record_activity(request)

    (record,) = caplog.records
    assert (record.levelname, record.run_id, record.rows) == ("ERROR", "run-1", 2)


def test_the_read_keeps_one_row_per_activity_id_from_the_last_90_days():
    assert (
        "QUALIFY row_number() OVER (PARTITION BY activity_id ORDER BY at) = 1"
        in activity.READ
    )
    assert "INTERVAL 90 DAYS" in activity.READ


def row(n: int) -> dict[str, str]:
    return {"activity_id": f"run:{n}", "at": f"2026-10-14T09:{n:02d}:00.000Z"}


def test_a_page_has_50_rows_and_a_cursor_for_the_next(statements):
    statements.rows = [row(n) for n in range(51)]

    page = activity.read_activity(SimpleNamespace(mode="user"), None)

    ((mode, _, parameters),) = statements.calls
    assert (mode, parameters) == ("user", {"before_at": None, "before_id": None})
    assert len(page["rows"]) == 50
    assert page["next"] == "2026-10-14T09:49:00.000Z|run:49"


def test_the_next_page_starts_after_the_cursor(statements):
    statements.rows = [row(1)]

    page = activity.read_activity(
        SimpleNamespace(mode="user"), "2026-10-14T09:49:00.000Z|run:49"
    )

    ((_, _, parameters),) = statements.calls
    assert parameters == {
        "before_at": "2026-10-14T09:49:00.000Z",
        "before_id": "run:49",
    }
    assert page == {"rows": [row(1)], "next": None}


@pytest.mark.parametrize(
    "cursor", ["run:49", "yesterday|run:49", "2026-10-14T09:49:00Z|"]
)
def test_a_malformed_cursor_is_refused(statements, cursor):
    with pytest.raises(ValueError, match="before must be the next cursor"):
        activity.read_activity(SimpleNamespace(mode="user"), cursor)

    assert statements.calls == []
