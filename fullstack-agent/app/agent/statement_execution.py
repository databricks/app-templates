import logging

from agents import SpanError
from agents.tracing import get_current_span
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import (
    ExecuteStatementRequestOnWaitTimeout,
    StatementParameterListItem,
    StatementState,
)

from agent.settings import settings

PERMISSION_ERROR_MARKERS = ("INSUFFICIENT_PERMISSIONS", "PERMISSION_DENIED")

logger = logging.getLogger(__name__)


class QueryFailed(Exception):
    """A statement did not succeed. The message is the warehouse's error text."""

    def __init__(self, message: str, state: StatementState | None = None) -> None:
        super().__init__(message)
        self.state = state

    @property
    def is_permission_error(self) -> bool:
        return any(marker in str(self) for marker in PERMISSION_ERROR_MARKERS)

    @property
    def is_wait_limit(self) -> bool:
        return self.state in (StatementState.CANCELED, StatementState.PENDING)

    @property
    def code(self) -> str:
        """QUERY_TIMEOUT, PERMISSION_DENIED or QUERY_FAILED, as the API reports it."""
        if self.is_wait_limit:
            return "QUERY_TIMEOUT"
        if self.is_permission_error:
            return "PERMISSION_DENIED"
        return "QUERY_FAILED"


def log_read_failure(error: QueryFailed, source: dict[str, str]) -> None:
    """Log a failed read: WARNING for permission, ERROR for others. Never quote data."""
    fields = {**source, "code": error.code}
    if error.state is not None:
        fields["state"] = error.state.value
    if error.is_permission_error:
        logger.warning("Read refused for lack of permission", extra=fields)
    else:
        logger.error("Read failed", extra=fields)


def report_read_failure(error: QueryFailed, tool: str, target: str) -> None:
    """Log the failed read and record error on the tool's span for MLflow status."""
    log_read_failure(error, {"tool": tool, "target": target})
    if span := get_current_span():
        span.set_error(
            SpanError(message="The read failed.", data={"error": str(error)})
        )


def run_query(
    client: WorkspaceClient, statement: str, parameters: dict[str, str] | None = None
) -> list[dict[str, str | None]]:
    """Run statement with client identity and grants; raise if truncated."""
    response = client.statement_execution.execute_statement(
        statement=statement,
        warehouse_id=settings().warehouse_id,
        catalog=settings().catalog,
        parameters=[
            StatementParameterListItem(name=name, value=value)
            for name, value in (parameters or {}).items()
        ],
        wait_timeout="50s",
        on_wait_timeout=ExecuteStatementRequestOnWaitTimeout.CANCEL,
    )
    if response.status.state != StatementState.SUCCEEDED:
        error = response.status.error.message if response.status.error else ""
        raise QueryFailed(
            f"{response.status.state.value}: {error}", state=response.status.state
        )
    if (
        response.manifest.total_chunk_count and response.manifest.total_chunk_count > 1
    ) or response.manifest.truncated:
        raise QueryFailed("The read was too large and has been refused.")
    columns = [column.name for column in response.manifest.schema.columns]
    rows = response.result.data_array if response.result else None
    return [dict(zip(columns, row, strict=True)) for row in rows or []]
