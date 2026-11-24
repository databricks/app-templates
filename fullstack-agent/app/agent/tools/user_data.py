import asyncio
import json
from typing import Literal

import mlflow
from agents import function_tool
from agents.tool_context import ToolContext
from mlflow.entities import SpanType

from agent.context import RequestContext
from agent.settings import settings
from agent.statement_execution import (
    QueryFailed,
    log_read_failure,
    report_read_failure,
    run_query,
)
from agent.tools import Step

BankTable = Literal["customers", "accounts", "transactions", "disputes", "action_audit"]

UNAVAILABLE = "This information is unavailable right now."
ROW_LIMIT = 100

QUERIES: dict[str, str] = {
    "customers": (
        "SELECT customer_id, full_name, phone, address_line1, city, postcode, "
        f"segment FROM {{table}} LIMIT {ROW_LIMIT}"
    ),
    "accounts": (
        "SELECT account_id, account_type, nickname, iban, currency, balance, "
        f"credit_limit, status FROM {{table}} ORDER BY account_id LIMIT {ROW_LIMIT}"
    ),
    "transactions": (
        "SELECT transaction_id, account_id, booked_at, amount, direction, merchant, "
        "category, channel, status FROM {table} "
        f"ORDER BY booked_at DESC, transaction_id LIMIT {ROW_LIMIT}"
    ),
    "disputes": (
        "SELECT dispute_id, transaction_id, reason_code, note, status, created_at "
        f"FROM {{table}} ORDER BY created_at DESC LIMIT {ROW_LIMIT}"
    ),
    "action_audit": (
        "SELECT audit_id, occurred_at, action, target_ids, amount, outcome, reason "
        f"FROM {{table}} ORDER BY occurred_at DESC LIMIT {ROW_LIMIT}"
    ),
}
PAYMENT_QUERY = (
    "SELECT merchant, amount, CAST(booked_at AS DATE) AS booked_on "
    "FROM {table} WHERE transaction_id = :transaction_id"
)


def table_name(table: str) -> str:
    """`table` in the app's schemas: the audit table is in ops, the rest in data."""
    schema = (
        settings().ops_schema if table == "action_audit" else settings().data_schema
    )
    return f"{schema}.{table}"


def query(table: str) -> str:
    """The fixed query that reads one of the customer's tables."""
    return QUERIES[table].format(table=table_name(table))


@mlflow.trace(name="payment_details", span_type=SpanType.TOOL)
async def payment_details(
    request: RequestContext, transaction_id: str
) -> dict[str, str]:
    """Get payment details; read as customer, emit Activity event like bank_data."""
    target = f"{settings().catalog}.{table_name('transactions')}"
    try:
        rows = await asyncio.to_thread(
            run_query,
            request.client_for("user"),
            PAYMENT_QUERY.format(table=table_name("transactions")),
            {"transaction_id": transaction_id},
        )
    except QueryFailed as error:
        event_kwargs = {}
        if error.is_wait_limit:
            event_kwargs["code"] = "QUERY_TIMEOUT"
        await request.tool_event("bank_data", "user", target, "denied", **event_kwargs)
        log_read_failure(error, {"tool": "payment_details", "target": target})
        if span := mlflow.get_current_active_span():
            span.record_exception(error)
        return {}
    await request.tool_event("bank_data", "user", target, "allowed")
    if not rows:
        return {}
    return {name: value for name, value in rows[0].items() if value is not None}


@function_tool
async def bank_data(
    ctx: ToolContext[RequestContext], step: Step, table: BankTable
) -> str:
    """Return the signed-in customer's own rows from one bank table.

    All queries return at most 100 rows, newest first where a time column exists.

    Args:
        table: customers for their name, phone and address; accounts for
            their accounts and balances; transactions for their transactions;
            disputes for the disputes they filed; action_audit for the changes
            they made or tried.
    """
    request = ctx.context
    target = f"{settings().catalog}.{table_name(table)}"
    try:
        rows = await asyncio.to_thread(
            run_query, request.client_for("user"), query(table)
        )
    except QueryFailed as error:
        event_kwargs = {"call_id": ctx.tool_call_id}
        if error.is_wait_limit:
            event_kwargs["code"] = "QUERY_TIMEOUT"
        await request.tool_event(
            "bank_data",
            "user",
            target,
            "denied",
            **event_kwargs,
        )
        report_read_failure(error, "bank_data", target)
        return UNAVAILABLE
    await request.tool_event(
        "bank_data", "user", target, "allowed", call_id=ctx.tool_call_id
    )
    return json.dumps(rows)
