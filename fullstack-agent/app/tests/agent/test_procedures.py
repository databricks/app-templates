import logging
import time

import pytest
from databricks.sdk.errors import PermissionDenied
from databricks.sdk.service.sql import (
    ResultData,
    ServiceError,
    StatementResponse,
    StatementState,
    StatementStatus,
)

from agent import procedures
from agent.procedures import ActionFailed, ProcedureClient
from tests.conftest import TEST_ACTIONS

RENAME = TEST_ACTIONS["rename_record"].procedure
PERMISSION_ERROR = (
    "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have "
    "EXECUTE on Routine or Model 'cat.test_ops.rename_record'."
)
CONFLICT_ERROR = (
    "[DELTA_CONCURRENT_APPEND.ROW_LEVEL_CHANGES] Transaction conflict detected. "
    "Retry the operation."
)


def succeeded(*row: str | None) -> StatementResponse:
    return StatementResponse(
        statement_id="s-1",
        status=StatementStatus(state=StatementState.SUCCEEDED),
        result=ResultData(data_array=[list(row)]),
    )


def failed(message: str) -> StatementResponse:
    return StatementResponse(
        statement_id="s-1",
        status=StatementStatus(
            state=StatementState.FAILED, error=ServiceError(message=message)
        ),
    )


def pending() -> StatementResponse:
    return StatementResponse(
        statement_id="s-1", status=StatementStatus(state=StatementState.PENDING)
    )


class FakeStatements:
    def __init__(self, *responses: StatementResponse):
        self.responses = list(responses)
        self.requests: list[dict] = []

    def execute_statement(self, **request) -> StatementResponse:
        self.requests.append(request)
        return self.responses.pop(0)

    def get_statement(self, statement_id: str) -> StatementResponse:
        return self.responses.pop(0)


class FakeWorkspace:
    def __init__(self, statements: FakeStatements):
        self.statement_execution = statements


RENAME_INPUT = {
    "record_id": "R-2001",
    "name": "Archive",
    "amount": "200.00",
    "idempotency_key": "key-0001",
}


def test_call_binds_inputs_and_reads_out_parameters():
    statements = FakeStatements(
        succeeded("OK", "REF-1", "user@example.com", "Record renamed.")
    )
    client = ProcedureClient(
        FakeWorkspace(statements), "wh-1", "test_catalog", "test_ops"
    )

    result = client.call(RENAME, RENAME_INPUT)

    request = statements.requests[0]
    assert (
        "CALL test_ops.rename_record(:record_id, "
        ":name, CAST(:amount AS DECIMAL(12, 2)), :idempotency_key, "
        "out_status, out_reference, out_acted_as, out_message)"
    ) in request["statement"]
    assert (request["warehouse_id"], request["catalog"]) == ("wh-1", "test_catalog")
    assert {p.name: p.value for p in request["parameters"]} == RENAME_INPUT
    assert result.to_dict() == {
        "status": "OK",
        "reference": "REF-1",
        "acted_as": "user@example.com",
        "message": "Record renamed.",
    }


def test_missing_execute_grant_is_reported_as_denied():
    client = ProcedureClient(
        FakeWorkspace(FakeStatements(failed(PERMISSION_ERROR))), "w", "c", "o"
    )

    result = client.call(RENAME, RENAME_INPUT)

    assert (result.status, result.message) == ("DENIED", PERMISSION_ERROR)


def test_other_failures_raise_with_the_warehouse_error():
    client = ProcedureClient(
        FakeWorkspace(FakeStatements(failed("[PARSE_SYNTAX_ERROR] near CALL"))),
        "w",
        "c",
        "o",
    )

    with pytest.raises(ActionFailed, match="rename_record.*PARSE_SYNTAX"):
        client.call(RENAME, RENAME_INPUT)


def test_a_pending_statement_is_polled_until_it_finishes(monkeypatch):
    monkeypatch.setattr(procedures, "POLL_SECONDS", 0)
    statements = FakeStatements(
        pending(), pending(), succeeded("OK_REPLAYED", "REF-1", "c@example.com", None)
    )
    client = ProcedureClient(FakeWorkspace(statements), "w", "c", "o")

    result = client.call(RENAME, RENAME_INPUT)

    assert (result.status, result.reference) == ("OK_REPLAYED", "REF-1")


def test_deadline_stops_polling_and_raises_without_cancel(monkeypatch):
    monkeypatch.setattr(procedures, "POLL_SECONDS", 0)

    elapsed = [0]

    def fake_monotonic():
        return elapsed[0]

    monkeypatch.setattr(time, "monotonic", fake_monotonic)

    execute_count = [0]

    class FakeStmtExecution:
        def __init__(self):
            self.requests = []

        def execute_statement(self, **kwargs):
            self.requests.append(kwargs)
            execute_count[0] += 1
            if execute_count[0] == 1:
                return pending()
            raise AssertionError("Should not execute after deadline")

        def get_statement(self, statement_id):
            elapsed[0] = 46
            return pending()

    class FakeWsDeadline:
        def __init__(self):
            self.statement_execution = FakeStmtExecution()

    client = ProcedureClient(FakeWsDeadline(), "w", "c", "o")

    with pytest.raises(
        ActionFailed,
        match="exceeded 45.*s deadline",
    ):
        client.call(RENAME, RENAME_INPUT)

    assert execute_count[0] == 1


def test_a_failure_during_the_call_propagates():
    statements = FakeStatements(failed("[INTERNAL_ERROR] warehouse is down"))
    client = ProcedureClient(FakeWorkspace(statements), "w", "c", "o")

    with pytest.raises(ActionFailed, match="warehouse is down"):
        client.call(RENAME, RENAME_INPUT)


def test_a_delta_concurrent_failure_is_retried_and_succeeds(monkeypatch):
    monkeypatch.setattr(procedures, "POLL_SECONDS", 0)
    statements = FakeStatements(
        failed(CONFLICT_ERROR),
        succeeded("OK", "REF-1", "user@example.com", "Record renamed."),
    )
    client = ProcedureClient(FakeWorkspace(statements), "w", "c", "o")

    result = client.call(RENAME, RENAME_INPUT)

    assert result.to_dict() == {
        "status": "OK",
        "reference": "REF-1",
        "acted_as": "user@example.com",
        "message": "Record renamed.",
    }


def test_two_conflicts_then_a_third_conflict_raises(monkeypatch):
    monkeypatch.setattr(procedures, "POLL_SECONDS", 0)
    statements = FakeStatements(
        failed(CONFLICT_ERROR),
        failed(CONFLICT_ERROR),
        failed(CONFLICT_ERROR),
    )
    client = ProcedureClient(FakeWorkspace(statements), "w", "c", "o")

    with pytest.raises(ActionFailed, match="DELTA_CONCURRENT"):
        client.call(RENAME, RENAME_INPUT)


def test_non_conflict_failure_is_not_retried(monkeypatch):
    monkeypatch.setattr(procedures, "POLL_SECONDS", 0)
    statements = FakeStatements(
        failed("[PARSE_SYNTAX_ERROR] near CALL"),
    )
    client = ProcedureClient(FakeWorkspace(statements), "w", "c", "o")

    with pytest.raises(ActionFailed, match="PARSE_SYNTAX"):
        client.call(RENAME, RENAME_INPUT)

    assert len(statements.requests) == 1


def test_retry_uses_same_parameters_and_key(monkeypatch):
    monkeypatch.setattr(procedures, "POLL_SECONDS", 0)
    statements = FakeStatements(
        failed(CONFLICT_ERROR),
        succeeded("OK", "REF-1", "user@example.com", "Record renamed."),
    )
    fake_workspace = FakeWorkspace(statements)
    client = ProcedureClient(fake_workspace, "w", "c", "o")

    client.call(RENAME, RENAME_INPUT)

    assert len(fake_workspace.statement_execution.requests) == 2
    first_request = fake_workspace.statement_execution.requests[0]
    second_request = fake_workspace.statement_execution.requests[1]
    assert {p.name: p.value for p in first_request["parameters"]} == RENAME_INPUT
    assert {p.name: p.value for p in second_request["parameters"]} == RENAME_INPUT


@pytest.mark.parametrize(("seconds_used", "wait_timeout"), [(0, "44s"), (41, "0s")])
def test_each_wait_fits_in_the_time_left(monkeypatch, seconds_used, wait_timeout):
    clock = iter([0, seconds_used])
    monkeypatch.setattr(procedures, "POLL_SECONDS", 0)
    monkeypatch.setattr(time, "monotonic", lambda: next(clock, seconds_used))
    statements = FakeStatements(
        succeeded("OK", "REF-1", "user@example.com", "Record renamed."),
    )
    workspace = FakeWorkspace(statements)

    ProcedureClient(workspace, "w", "c", "o").call(RENAME, RENAME_INPUT)

    assert workspace.statement_execution.requests[0]["wait_timeout"] == wait_timeout


def test_each_statement_logs_its_id_state_and_duration(caplog):
    client = ProcedureClient(
        FakeWorkspace(
            FakeStatements(failed(CONFLICT_ERROR), succeeded("OK", "REF-1", "u", None))
        ),
        "w",
        "c",
        "o",
    )

    with caplog.at_level(logging.INFO, logger="agent"):
        client.call(RENAME, RENAME_INPUT)

    assert [
        (record.levelname, record.procedure, record.statement_id, record.state)
        for record in caplog.records
    ] == [
        ("INFO", RENAME.name, "s-1", "FAILED"),
        ("INFO", RENAME.name, "s-1", "SUCCEEDED"),
    ]
    assert all(isinstance(record.duration_ms, int) for record in caplog.records)
    assert RENAME_INPUT["record_id"] not in repr(
        [vars(record) for record in caplog.records]
    )


def test_a_refused_call_logs_a_permission_refusal(caplog):
    client = ProcedureClient(
        FakeWorkspace(FakeStatements(failed(PERMISSION_ERROR))), "w", "c", "o"
    )

    with caplog.at_level(logging.INFO, logger="agent"):
        client.call(RENAME, RENAME_INPUT)

    refusal = caplog.records[-1]
    assert (refusal.levelname, refusal.procedure, refusal.statement_id) == (
        "WARNING",
        RENAME.name,
        "s-1",
    )
    assert PERMISSION_ERROR not in repr(vars(refusal))


def test_a_submission_the_workspace_refuses_is_denied(caplog):
    class RefusingStatements(FakeStatements):
        def execute_statement(self, **request):
            raise PermissionDenied("You are not authorized to use this warehouse.")

    client = ProcedureClient(FakeWorkspace(RefusingStatements()), "w", "c", "o")

    with caplog.at_level(logging.INFO, logger="agent"):
        result = client.call(RENAME, RENAME_INPUT)

    assert (result.status, result.message) == (
        "DENIED",
        "You are not authorized to use this warehouse.",
    )
    assert caplog.records[-1].levelname == "WARNING"
