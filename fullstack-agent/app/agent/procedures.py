import logging
import time
from dataclasses import asdict, dataclass

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import PermissionDenied
from databricks.sdk.service.sql import (
    StatementParameterListItem,
    StatementResponse,
    StatementState,
)

PERMISSION_ERROR_MARKERS = ("INSUFFICIENT_PERMISSIONS", "PERMISSION_DENIED")
CONFLICT_ERROR_PREFIX = "[DELTA_CONCURRENT_"
FINAL_STATES = (
    StatementState.SUCCEEDED,
    StatementState.FAILED,
    StatementState.CANCELED,
    StatementState.CLOSED,
)
POLL_SECONDS = 1.0
CALL_DEADLINE_SECONDS = 45.0
MAX_RETRIES = 2

logger = logging.getLogger(__name__)


class ActionFailed(Exception):
    """A procedure call failed for a reason other than missing permissions."""


@dataclass(frozen=True)
class Procedure:
    """A write procedure in the ops schema, and the SQL that binds its inputs."""

    name: str
    arguments: str


@dataclass(frozen=True)
class ActionResult:
    """Result of a procedure call with status, reference, acted_as, and message."""

    status: str
    reference: str | None
    acted_as: str | None
    message: str | None

    def to_dict(self) -> dict:
        return asdict(self)


def call_statement(procedure: Procedure, schema: str) -> str:
    """Wrap a CALL so its OUT parameters come back as one result row."""
    return (
        "BEGIN "
        "DECLARE out_status STRING; DECLARE out_reference STRING; "
        "DECLARE out_acted_as STRING; DECLARE out_message STRING; "
        f"CALL {schema}.{procedure.name}({procedure.arguments}, "
        "out_status, out_reference, out_acted_as, out_message); "
        "SELECT out_status, out_reference, out_acted_as, out_message; "
        "END"
    )


class ProcedureClient:
    """Run write procedures as the caller; ensures proper authorization."""

    def __init__(
        self, workspace: WorkspaceClient, warehouse_id: str, catalog: str, schema: str
    ) -> None:
        self._workspace = workspace
        self._warehouse_id = warehouse_id
        self._catalog = catalog
        self._schema = schema

    def call(self, procedure: Procedure, parameters: dict[str, str]) -> ActionResult:
        """Execute procedure with Delta retry, 45s deadline, no cancellation."""
        deadline = time.monotonic() + CALL_DEADLINE_SECONDS
        retry_count = 0

        while True:
            time_left = deadline - time.monotonic()
            if time_left <= 0:
                raise ActionFailed(
                    f"Call to {procedure.name} exceeded "
                    f"{CALL_DEADLINE_SECONDS:.0f}s deadline. Check that the SQL "
                    "warehouse is running."
                )

            if time_left < 5:
                wait_timeout = "0s"
            else:
                wait_timeout = f"{min(50, time_left - 1):.0f}s"
            started = time.monotonic()
            try:
                response = self._workspace.statement_execution.execute_statement(
                    statement=call_statement(procedure, self._schema),
                    warehouse_id=self._warehouse_id,
                    catalog=self._catalog,
                    parameters=[
                        StatementParameterListItem(name=name, value=value)
                        for name, value in parameters.items()
                    ],
                    wait_timeout=wait_timeout,
                )
            except PermissionDenied as error:
                logger.warning(
                    "Procedure call refused before it ran",
                    extra={"procedure": procedure.name},
                )
                return ActionResult("DENIED", None, None, str(error))

            response = self._wait_with_deadline(response, deadline)
            logger.info(
                "Procedure statement ended",
                extra={
                    "procedure": procedure.name,
                    "statement_id": response.statement_id,
                    "state": response.status.state.value,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                },
            )
            if response.status.state == StatementState.SUCCEEDED:
                status, reference, acted_as, message = response.result.data_array[0]
                return ActionResult(status, reference, acted_as, message)

            error = response.status.error.message if response.status.error else ""
            if any(marker in error for marker in PERMISSION_ERROR_MARKERS):
                logger.warning(
                    "Procedure refused for lack of permission",
                    extra={
                        "procedure": procedure.name,
                        "statement_id": response.statement_id,
                    },
                )
                return ActionResult("DENIED", None, None, error)

            if error.startswith(CONFLICT_ERROR_PREFIX) and retry_count < MAX_RETRIES:
                retry_count += 1
                continue

            state = response.status.state.value
            raise ActionFailed(f"{procedure.name} ended in state {state}: {error}")

    def _wait_with_deadline(
        self, response: StatementResponse, deadline: float
    ) -> StatementResponse:
        """Poll statement to final state or deadline. Never cancels."""
        while response.status.state not in FINAL_STATES:
            time_left = deadline - time.monotonic()
            if time_left <= 0:
                logger.error(
                    "Procedure statement passed the call deadline",
                    extra={
                        "statement_id": response.statement_id,
                        "state": response.status.state.value,
                    },
                )
                raise ActionFailed(
                    f"Statement {response.statement_id} exceeded "
                    f"{CALL_DEADLINE_SECONDS:.0f}s deadline. Check that the SQL "
                    "warehouse is running."
                )
            time.sleep(POLL_SECONDS)
            response = self._workspace.statement_execution.get_statement(
                response.statement_id
            )
        return response
