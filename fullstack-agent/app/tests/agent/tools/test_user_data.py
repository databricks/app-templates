"""bank_data and payment_details: fixed queries as the customer."""

import json
import logging
import re
from unittest.mock import ANY

from agents.tool_context import ToolContext
from databricks.sdk.service.sql import (
    StatementState,
)
from mlflow.entities import SpanStatusCode, SpanType

from agent.agent import instructions
from agent.statement_execution import QueryFailed
from agent.tools import user_data as bank
from tests.conftest import STEP, asks_for, build_agent, spans_by_name, traced_run

PERMISSION_ERROR = (
    "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have "
    "SELECT on Table 'test_catalog.test_reference.products'."
)


async def invoke_bank_data(request, table: str) -> str:
    arguments = json.dumps({"step": STEP, "table": table})
    return await bank.bank_data.on_invoke_tool(
        ToolContext(
            context=request,
            tool_name="bank_data",
            tool_call_id="call-1",
            tool_arguments=arguments,
        ),
        arguments,
    )


async def test_bank_data_runs_the_fixed_query_as_the_user(
    monkeypatch, request_context, recorder
):
    calls = []
    monkeypatch.setattr(
        bank,
        "run_query",
        lambda client, statement: calls.append((client.mode, statement)) or [],
    )

    output = await invoke_bank_data(request_context, "transactions")

    assert calls == [("user", bank.query("transactions"))]
    assert recorder.events == [
        {
            "type": "tool_event",
            "at": ANY,
            "tool": "bank_data",
            "identity": "user",
            "target": "test_catalog.test_data.transactions",
            "outcome": "allowed",
            "call_id": "call-1",
        }
    ]
    assert output == "[]"


async def test_bank_data_reads_only_the_tables_it_offers(
    monkeypatch, request_context, recorder
):
    calls = []
    monkeypatch.setattr(bank, "run_query", lambda *arguments: calls.append(arguments))

    output = await invoke_bank_data(request_context, "accounts; UPDATE accounts")

    assert calls == []
    assert recorder.events == []
    assert "error" in output.lower()


async def test_bank_data_reports_a_refused_read(
    monkeypatch, request_context, recorder, tool_span
):
    def refuse(client, statement):
        raise QueryFailed(f"FAILED: {PERMISSION_ERROR}")

    monkeypatch.setattr(bank, "run_query", refuse)

    output = await invoke_bank_data(request_context, "accounts")

    assert (recorder.events[0]["outcome"], recorder.events[0]["call_id"]) == (
        "denied",
        "call-1",
    )
    assert "error" not in recorder.events[0]
    assert "INSUFFICIENT_PERMISSIONS" in tool_span.error["data"]["error"]
    assert output == "This information is unavailable right now."


async def test_a_failed_read_tool_event_carries_no_error(
    monkeypatch, request_context, recorder
):
    """Verify that failed read tool events do not include the raw error text."""

    def refuse(client, statement):
        raise QueryFailed(f"FAILED: {PERMISSION_ERROR}")

    monkeypatch.setattr(bank, "run_query", refuse)

    await invoke_bank_data(request_context, "customers")

    event = recorder.events[0]
    assert event["outcome"] == "denied"
    assert "error" not in event


async def test_truncated_response_shows_user_friendly_message(
    monkeypatch, request_context, recorder, tool_span
):
    """Verify that a truncated result error is user-friendly, not raw warehouse text."""

    def truncated(client, statement):
        raise QueryFailed("The read was too large and has been refused.")

    monkeypatch.setattr(bank, "run_query", truncated)

    output = await invoke_bank_data(request_context, "transactions")

    assert recorder.events[0]["outcome"] == "denied"
    assert "error" not in recorder.events[0]
    assert output == "This information is unavailable right now."


async def test_a_failed_read_logs_one_record_with_its_fields_and_no_row_data(
    monkeypatch, request_context, recorder, tool_span, caplog
):
    def fail(client, statement):
        raise QueryFailed(
            "FAILED: [CAST_INVALID_INPUT] 'Alex Morgan' cannot be cast",
            state=StatementState.FAILED,
        )

    monkeypatch.setattr(bank, "run_query", fail)

    with caplog.at_level(logging.INFO, logger="agent"):
        await invoke_bank_data(request_context, "customers")

    (record,) = caplog.records
    assert (record.levelname, record.tool, record.target, record.code) == (
        "ERROR",
        "bank_data",
        "test_catalog.test_data.customers",
        "QUERY_FAILED",
    )
    assert record.state == "FAILED"
    assert "Alex Morgan" not in repr(vars(record))


def test_the_prompt_names_only_tools_tables_and_columns_the_model_sees():
    columns = {
        column
        for query in bank.QUERIES.values()
        for column in re.search(r"SELECT (.+?) FROM", query)[1].split(", ")
    }
    known = {tool.name for tool in build_agent([]).tools} | set(bank.QUERIES) | columns

    named = set(re.findall(r"\b[a-z]+(?:[._][a-z]+)+\b", instructions()))

    assert named
    assert named <= known


DISPUTE = {
    "step": "Preparing your dispute",
    "transaction_id": "TX-1003-899",
    "reason_code": "UNRECOGNISED",
    "note": "",
}


async def test_a_failed_payment_read_marks_only_its_own_span(
    streaming_model, agent_traces, monkeypatch
):
    def fail(client, statement, parameters=None):
        raise QueryFailed(
            "CANCELED: the warehouse is starting", StatementState.CANCELED
        )

    monkeypatch.setattr(bank, "run_query", fail)

    trace = await traced_run(streaming_model, asks_for("propose_file_dispute", DISPUTE))

    spans = spans_by_name(trace)
    payment = spans["payment_details"]
    assert payment.span_type == SpanType.TOOL
    assert payment.parent_id == spans["propose_file_dispute"].span_id
    assert payment.status.status_code == SpanStatusCode.ERROR
    assert spans["propose_file_dispute"].status.status_code == SpanStatusCode.OK
