"""The bank's proposal tools: their cards, rules and procedures."""

import hashlib
import json
import re
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from typing import get_args
from unittest.mock import ANY

import pytest
from agents.tool_context import ToolContext

from agent import approvals
from agent.procedures import ActionFailed, ActionResult
from agent.statement_execution import QueryFailed
from agent.tools import actions, user_data
from agent.tools.display import DISPLAY_TOOLS
from tests.conftest import STEP, build_agent, internal_names_in, request_for

TRANSFER = {
    "from_account_id": "ACC-2001",
    "to_account_id": "ACC-2002",
    "amount": "200.00",
}
RAW_ERROR = "warehouse is down"
confirm = partial(approvals.confirm, actions=actions.ACTIONS)

ROOT = Path(__file__).resolve().parents[4]

PROCEDURES = ROOT / "sql" / "data" / "procedures.sql"

TOOLS = {
    "file_dispute": actions.propose_file_dispute,
    "transfer_between_own_accounts": actions.propose_transfer,
    "update_contact_details": actions.propose_contact_update,
}


def flat(text: str) -> str:
    return " ".join(text.split())


def procedure_rule(pattern: str) -> tuple[str, ...]:
    found = re.search(pattern, PROCEDURES.read_text())
    assert found, f"{PROCEDURES.name} no longer matches {pattern!r}"
    return found.groups()


async def prepared(tool, arguments: dict) -> bool:
    """Test if arguments validate and produce a confirmation card."""
    recorder = SimpleNamespace(events=[], modes=[])
    text = json.dumps({"step": STEP} | arguments)
    await tool.on_invoke_tool(
        ToolContext(
            context=request_for("session-a", recorder),
            tool_name=tool.name,
            tool_call_id="call-1",
            tool_arguments=text,
        ),
        text,
    )
    return bool(recorder.events)


def action_result(
    status: str,
    reference: str | None = None,
    acted_as: str | None = None,
    message: str | None = None,
) -> ActionResult:
    return ActionResult(
        status=status, reference=reference, acted_as=acted_as, message=message
    )


@pytest.fixture(autouse=True)
def payments(monkeypatch) -> SimpleNamespace:
    """The customer's payments by ID, as the dispute card's lookup reads them."""
    rows: dict[str, dict[str, str | None]] = {}
    reads: list[tuple[str, str, dict]] = []

    def run_query(client, statement: str, parameters: dict) -> list[dict]:
        reads.append((client.mode, statement, parameters))
        row = rows.get(parameters["transaction_id"])
        if isinstance(row, Exception):
            raise row
        return [row] if row else []

    monkeypatch.setattr(user_data, "run_query", run_query)
    return SimpleNamespace(rows=rows, reads=reads)


@pytest.fixture
def action_calls(monkeypatch) -> SimpleNamespace:
    calls: list[tuple[str, str, dict]] = []
    results: list[ActionResult | BaseException] = []

    class FakeProcedureClient:
        def __init__(self, workspace, warehouse_id, catalog, schema):
            self.workspace = workspace
            self.warehouse_id = warehouse_id
            self.catalog = catalog

        def call(self, procedure, parameters):
            action = procedure.name.split(".")[-1]
            calls.append((self.workspace.mode, action, parameters))
            result = results.pop(0)
            if isinstance(result, BaseException):
                raise result
            return result

    monkeypatch.setattr("agent.approvals.ProcedureClient", FakeProcedureClient)
    return SimpleNamespace(calls=calls, results=results)


async def invoke(request, tool, arguments: dict) -> str:
    """Invoke a tool with SDK formatting; add step label if not provided."""
    text = json.dumps({"step": STEP} | arguments)
    return await tool.on_invoke_tool(
        ToolContext(
            context=request,
            tool_name=tool.name,
            tool_call_id="call-1",
            tool_arguments=text,
        ),
        text,
    )


async def propose_transfer(request, recorder) -> str:
    await invoke(request, actions.propose_transfer, TRANSFER)
    return recorder.events[-1]["proposal_id"]


def key_for(session_id: str, proposal_id: str) -> str:
    return hashlib.sha256(f"{session_id}:{proposal_id}".encode()).hexdigest()


async def test_amounts_have_the_proposal_tool_digits():
    transfer = {"from_account_id": "ACC-1001", "to_account_id": "ACC-1002"}

    assert await prepared(
        actions.propose_transfer, transfer | {"amount": "9999999999.99"}
    )
    assert not await prepared(
        actions.propose_transfer, transfer | {"amount": "99999999999.99"}
    )
    assert not await prepared(actions.propose_transfer, transfer | {"amount": "1.999"})


def test_the_reason_codes_match_the_procedure():
    (codes,) = procedure_rule(r"dispute_reason NOT IN \(([^)]*)\)")

    assert set(re.findall(r"'([A-Z_]+)'", codes)) == set(get_args(actions.ReasonCode))


def test_the_dispute_description_states_the_procedures_rules():
    (days,) = procedure_rule(r"INTERVAL (\d+) DAYS THEN")
    (note,) = procedure_rule(r"length\(customer_note\) > (\d+)")
    tool = actions.propose_file_dispute

    assert f"booked in the last {days} days" in flat(tool.description)
    assert f"at most {note} characters" in flat(
        tool.params_json_schema["properties"]["note"]["description"]
    )


def test_the_transfer_description_states_the_procedures_rules():
    (low,) = procedure_rule(r"transfer_amount <= (\d+) THEN")
    (high,) = procedure_rule(r"transfer_amount > (\d+) THEN")
    description = flat(actions.propose_transfer.description)

    assert f"The amount is above {low}, at most EUR {int(high):,}," in description


def test_the_contact_description_states_the_procedures_rules():
    shortest, longest = procedure_rule(
        r"RLIKE '\^\[\+\]\[1-9\]\[0-9\]\{(\d+),(\d+)\}\$'"
    )
    address, city, postcode = procedure_rule(
        r"length\(new_address_line1\) > (\d+) OR length\(new_city\) > (\d+) "
        r"OR length\(new_postcode\) > (\d+)"
    )
    description = flat(actions.propose_contact_update.description)

    assert (
        f"a plus sign and {int(shortest) + 1} to {int(longest) + 1} digits, with no "
        "spaces and a first digit that isn't 0"
    ) in description
    assert address == city
    assert (
        f"The address and city are at most {address} characters, and the postcode "
        f"at most {postcode}."
    ) in description


@pytest.mark.parametrize("action", sorted(TOOLS))
def test_every_proposal_binds_exactly_its_procedures_parameters(action):
    properties = set(TOOLS[action].params_json_schema["properties"]) - {"step"}
    markers = set(re.findall(r":(\w+)", actions.ACTIONS[action].procedure.arguments))

    assert markers == properties | {"idempotency_key"}


def test_the_agent_offers_reads_proposals_displays_and_calculate_but_no_direct_writes():
    agent = build_agent([])

    assert sorted(tool.name for tool in agent.tools) == sorted(
        [
            "bank_data",
            "calculate",
            "product_rates",
            "propose_contact_update",
            "propose_file_dispute",
            "propose_transfer",
            *DISPLAY_TOOLS,
        ]
    )
    assert agent.mcp_servers == []


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        (
            actions.propose_file_dispute,
            {
                "transaction_id": "TX-1003-899",
                "reason_code": "UNRECOGNISED",
                "note": "",
            },
        ),
        (
            actions.propose_transfer,
            {"from_account_id": "ACC-1001", "to_account_id": "ACC-1002", "amount": 100},
        ),
        (
            actions.propose_transfer,
            {"from_account_id": "ACC-2001", "to_account_id": "ACC-2002", "amount": 200},
        ),
        (
            actions.propose_transfer,
            {"from_account_id": "ACC-10001", "to_account_id": "ACC-1002", "amount": 1},
        ),
    ],
)
async def test_the_demo_scene_ids_get_a_card(
    request_context, recorder, tool, arguments
):
    await invoke(request_context, tool, arguments)

    cards = [event for event in recorder.events if event.get("tool") != "bank_data"]
    assert [event["type"] for event in cards] == ["confirmation_required"]


DISPUTE = {"transaction_id": "TX-1003-899", "reason_code": "DUPLICATE", "note": ""}

PAYMENT = {"merchant": "City Bakery", "amount": "4.50", "booked_on": "2026-10-01"}

PAYMENT_READ = {
    "type": "tool_event",
    "at": ANY,
    "tool": "bank_data",
    "identity": "user",
    "target": "test_catalog.test_data.transactions",
}


def card_of(recorder: SimpleNamespace) -> dict:
    return next(e for e in recorder.events if e["type"] == "confirmation_required")


async def test_a_dispute_card_names_the_payment_from_the_bank_data(
    request_context, recorder, payments, action_calls
):
    payments.rows["TX-1003-899"] = PAYMENT
    await invoke(request_context, actions.propose_file_dispute, DISPUTE)
    proposal_id = recorder.events[-1]["proposal_id"]
    action_calls.results.append(
        action_result(
            status="OK", reference="DSP-1", acted_as="c@example.com", message=""
        )
    )

    await confirm(request_context, proposal_id, "approve", recorder.events)

    assert recorder.events[0] == PAYMENT_READ | {"outcome": "allowed"}
    assert card_of(recorder)["args"] == PAYMENT | DISPUTE
    assert list(card_of(recorder)["args"]) == [*PAYMENT, *DISPUTE]
    mode, statement, parameters = payments.reads[0]
    assert (mode, parameters) == ("user", {"transaction_id": "TX-1003-899"})
    assert ":transaction_id" in statement
    assert action_calls.calls[0][2] == DISPUTE | {
        "idempotency_key": key_for("session-a", proposal_id)
    }


@pytest.mark.parametrize(
    ("row", "outcome"),
    [
        (None, "allowed"),
        (QueryFailed("FAILED: [INSUFFICIENT_PERMISSIONS] on test_data"), "denied"),
    ],
)
async def test_a_dispute_card_without_the_payment_keeps_only_the_reference(
    request_context, recorder, payments, row, outcome
):
    if row is not None:
        payments.rows["TX-1003-899"] = row

    await invoke(request_context, actions.propose_file_dispute, DISPUTE)

    read = recorder.events[0]
    assert {key: read[key] for key in [*PAYMENT_READ, "outcome"]} == PAYMENT_READ | {
        "outcome": outcome
    }
    assert "error" not in read
    assert card_of(recorder)["args"] == DISPUTE


def procedure_messages() -> list[str]:
    """Every refusal and status message the procedures can return."""
    text = PROCEDURES.read_text()
    found = re.findall(r"(?:THEN|SET message =)\s+'((?:[^'\\]|\\.)*)'", text)
    return [message.replace("\\'", "'") for message in found]


@pytest.mark.parametrize(
    "result",
    [
        action_result(status="OK", reference="TRF-1", acted_as="c@example.com"),
        action_result(
            status="OK_REPLAYED", reference="TRF-1", acted_as="c@example.com"
        ),
        action_result(
            status="DENIED", reference=None, acted_as=None, message=RAW_ERROR
        ),
        *(
            action_result(
                status="REJECTED", reference=None, acted_as=None, message=text
            )
            for text in procedure_messages()
        ),
        ActionFailed(RAW_ERROR),
        ActionFailed(RAW_ERROR),
        ConnectionError(RAW_ERROR),
    ],
)
async def test_confirmation_replies_name_nothing_internal(
    request_context, recorder, action_calls, result
):
    proposal_id = await propose_transfer(request_context, recorder)
    action_calls.results.append(result)

    try:
        reply = await confirm(request_context, proposal_id, "approve", recorder.events)
    except approvals.ConfirmationFailed as failure:
        reply = failure.reply

    assert internal_names_in(reply) == []


async def test_the_procedures_messages_are_read():
    assert "Both accounts must be different open accounts in your name." in (
        procedure_messages()
    )
    assert "We can't find this payment in your accounts." in procedure_messages()
