"""product_rates: the shared product table, read as the app."""

import json
import logging
from unittest.mock import ANY

from agents.tool_context import ToolContext
from databricks.sdk.service.sql import (
    StatementState,
)

from agent.statement_execution import QueryFailed
from agent.tools import reference_data as products
from tests.conftest import STEP

PRODUCT = {
    "product_id": "P-EASY-SAVER",
    "name": "Easy Saver",
    "type": "SAVINGS",
    "rate_pct": "2.10",
    "monthly_fee": "0.00",
    "terms": "Variable rate.",
}

PERMISSION_ERROR = (
    "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have "
    "SELECT on Table 'test_catalog.test_reference.products'."
)


async def invoke_product_rates(request) -> str:
    arguments = json.dumps({"step": STEP})
    return await products.product_rates.on_invoke_tool(
        ToolContext(
            context=request,
            tool_name="product_rates",
            tool_call_id="call-1",
            tool_arguments=arguments,
        ),
        arguments,
    )


async def test_product_rates_read_with_the_app_identity(
    monkeypatch, request_context, recorder
):
    clients = []
    monkeypatch.setattr(
        products,
        "run_query",
        lambda client, statement: clients.append(client) or [PRODUCT],
    )

    output = await invoke_product_rates(request_context)

    assert [client.mode for client in clients] == ["app"]
    assert recorder.modes == ["app"]
    assert recorder.events == [
        {
            "type": "tool_event",
            "at": ANY,
            "tool": "product_rates",
            "identity": "app",
            "target": "test_catalog.test_reference.products",
            "outcome": "allowed",
            "call_id": "call-1",
        }
    ]
    assert "Easy Saver" in output


async def test_product_rates_report_a_refused_read(
    monkeypatch, request_context, recorder, tool_span
):
    def refuse(client, statement):
        raise QueryFailed(f"FAILED: {PERMISSION_ERROR}")

    monkeypatch.setattr(products, "run_query", refuse)

    output = await invoke_product_rates(request_context)

    assert recorder.events[0]["outcome"] == "denied"
    assert "error" not in recorder.events[0]
    assert "INSUFFICIENT_PERMISSIONS" in tool_span.error["data"]["error"]
    assert output == "Product rates are unavailable right now."


async def test_a_refused_read_logs_a_permission_refusal(
    monkeypatch, request_context, recorder, tool_span, caplog
):
    def refuse(client, statement):
        raise QueryFailed(f"FAILED: {PERMISSION_ERROR}", state=StatementState.FAILED)

    monkeypatch.setattr(products, "run_query", refuse)

    with caplog.at_level(logging.INFO, logger="agent"):
        await invoke_product_rates(request_context)

    (record,) = caplog.records
    assert (record.levelname, record.tool, record.target, record.code) == (
        "WARNING",
        "product_rates",
        "test_catalog.test_reference.products",
        "PERMISSION_DENIED",
    )
    assert PERMISSION_ERROR not in repr(vars(record))
