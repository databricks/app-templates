"""Record and retrieve Activity (reads and writes) as the app identity."""

import asyncio
import json
import logging
from datetime import datetime
from typing import Any

from databricks.sdk import WorkspaceClient

from agent.context import RequestContext
from agent.settings import settings
from agent.statement_execution import QueryFailed, run_query

logger = logging.getLogger(__name__)

WRITE_ATTEMPTS = 2
PAGE_SIZE = 50
SHOWN_DAYS = 90
LEFT_OUT_TOOLS = ("model",)
EVENT_FIELDS = (
    "activity_id",
    "at",
    "tool",
    "identity",
    "target",
    "outcome",
    "status",
    "reference",
    "proposal_id",
)

INSERT = (
    "INSERT INTO {table} "
    "(activity_id, owner_email, session_id, run_id, at, tool, identity, "
    "target, outcome, status, reference, proposal_id) "
    "SELECT activity_id, :owner_email, :session_id, :run_id, "
    "CAST(at AS TIMESTAMP), tool, identity, target, outcome, status, reference, "
    "proposal_id FROM (SELECT inline(from_json(:rows, 'ARRAY<STRUCT<"
    + ", ".join(f"{name}: STRING" for name in EVENT_FIELDS)
    + ">>')))"
)

READ = (
    "SELECT activity_id, session_id, run_id, at, tool, identity, target, "
    "outcome, status, reference, proposal_id "
    "FROM {table} "
    f"WHERE at >= current_timestamp() - INTERVAL {SHOWN_DAYS} DAYS "
    "AND (:before_at IS NULL OR at < CAST(:before_at AS TIMESTAMP) "
    "OR (at = CAST(:before_at AS TIMESTAMP) AND activity_id < :before_id)) "
    "QUALIFY row_number() OVER (PARTITION BY activity_id ORDER BY at) = 1 "
    f"ORDER BY at DESC, activity_id DESC LIMIT {PAGE_SIZE + 1}"
)


def activity_table() -> str:
    return f"{settings().ops_schema}.assistant_activity"


async def record_activity(request: RequestContext) -> None:
    """Append run's tool events to Activity as the app identity, retrying once."""
    rows = [
        {name: event.get(name) for name in EVENT_FIELDS}
        for event in request.activity
        if event["tool"] not in LEFT_OUT_TOOLS
    ]
    if not rows:
        return
    parameters = {
        "owner_email": await request.user_name(),
        "session_id": request.session_id,
        "run_id": request.run_id,
        "rows": json.dumps(rows),
    }
    for attempt in range(1, WRITE_ATTEMPTS + 1):
        try:
            await asyncio.to_thread(
                run_query,
                request.client_for("app"),
                INSERT.format(table=activity_table()),
                parameters,
            )
            return
        except QueryFailed as error:
            if attempt == WRITE_ATTEMPTS:
                logger.error(
                    "Activity write failed",
                    extra={
                        "run_id": request.run_id,
                        "rows": len(rows),
                        "code": error.code,
                    },
                )


def cursor_of(row: dict[str, Any]) -> str:
    """The cursor that continues a page after `row`: its time and ID."""
    return f"{row['at']}|{row['activity_id']}"


def read_activity(client: WorkspaceClient, before: str | None) -> dict[str, Any]:
    """One page of Activity from last 90 days, newest first. Validate cursor."""
    before_at, before_id = None, None
    if before is not None:
        before_at, _, before_id = before.partition("|")
        try:
            datetime.fromisoformat(before_at)
        except ValueError as error:
            raise ValueError(
                f"before must be the next cursor of a previous page, got {before!r}."
            ) from error
        if not before_id:
            raise ValueError(
                f"before must be the next cursor of a previous page, got {before!r}."
            )
    rows = run_query(
        client,
        READ.format(table=activity_table()),
        {"before_at": before_at, "before_id": before_id},
    )
    page = rows[:PAGE_SIZE]
    more = len(rows) > PAGE_SIZE
    return {"rows": page, "next": cursor_of(page[-1]) if more else None}
