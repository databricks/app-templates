"""run_query: rows keyed by column, warehouse errors, size limits."""

from types import SimpleNamespace

import pytest
from databricks.sdk.service.sql import (
    ColumnInfo,
    ResultData,
    ResultManifest,
    ResultSchema,
    ServiceError,
    StatementResponse,
    StatementState,
    StatementStatus,
)

from agent.statement_execution import QueryFailed, run_query

PERMISSION_ERROR = (
    "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have "
    "SELECT on Table 'test_catalog.test_ops.records'."
)


def statements(response: StatementResponse) -> SimpleNamespace:
    requests: list[dict] = []

    def execute_statement(**request) -> StatementResponse:
        requests.append(request)
        return response

    return SimpleNamespace(
        statement_execution=SimpleNamespace(execute_statement=execute_statement),
        requests=requests,
    )


def test_run_query_returns_rows_keyed_by_column():
    client = statements(
        StatementResponse(
            status=StatementStatus(state=StatementState.SUCCEEDED),
            manifest=ResultManifest(
                schema=ResultSchema(
                    columns=[ColumnInfo(name="me"), ColumnInfo(name="total")]
                )
            ),
            result=ResultData(data_array=[["c@example.com", "3240.15"]]),
        )
    )

    rows = run_query(client, "SELECT :x", {"x": "1"})

    assert rows == [{"me": "c@example.com", "total": "3240.15"}]
    request = client.requests[0]
    assert (request["warehouse_id"], request["catalog"]) == ("wh-1", "test_catalog")
    assert [(p.name, p.value) for p in request["parameters"]] == [("x", "1")]


def test_run_query_raises_with_the_warehouse_error():
    client = statements(
        StatementResponse(
            status=StatementStatus(
                state=StatementState.FAILED,
                error=ServiceError(message=PERMISSION_ERROR),
            )
        )
    )

    with pytest.raises(QueryFailed, match="INSUFFICIENT_PERMISSIONS") as raised:
        run_query(client, "SELECT 1")

    assert raised.value.is_permission_error


def test_run_query_raises_when_response_has_multiple_chunks():
    client = statements(
        StatementResponse(
            status=StatementStatus(state=StatementState.SUCCEEDED),
            manifest=ResultManifest(
                schema=ResultSchema(
                    columns=[ColumnInfo(name="id"), ColumnInfo(name="value")]
                ),
                total_chunk_count=2,
            ),
            result=ResultData(data_array=[["1", "a"]]),
        )
    )

    with pytest.raises(QueryFailed, match="too large"):
        run_query(client, "SELECT 1")


def test_run_query_raises_when_response_is_truncated():
    client = statements(
        StatementResponse(
            status=StatementStatus(state=StatementState.SUCCEEDED),
            manifest=ResultManifest(
                schema=ResultSchema(
                    columns=[ColumnInfo(name="id"), ColumnInfo(name="value")]
                ),
                truncated=True,
            ),
            result=ResultData(data_array=[["1", "a"]]),
        )
    )

    with pytest.raises(QueryFailed, match="too large"):
        run_query(client, "SELECT 1")
