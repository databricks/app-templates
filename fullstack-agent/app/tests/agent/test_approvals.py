"""Propose, approve, reject, replay and refuse a write, with a test action."""

import asyncio
import hashlib
import json
import logging
import threading
import time
from functools import partial
from types import SimpleNamespace
from unittest.mock import ANY

import pytest
from agents.tool_context import ToolContext

from agent import approvals
from agent.procedures import ActionFailed, ActionResult
from tests.conftest import (
    RENAME,
    RENAME_TARGET,
    STEP,
    TEST_ACTIONS,
    internal_names_in,
    propose_rename,
    request_for,
)

RAW_ERROR = "warehouse is down"
NOT_FOUND = "We couldn't find that change. Nothing was changed."
ALREADY_CANCELLED = "This change was already cancelled. Nothing was changed."
ALREADY_DECIDED = "This change was already decided, so it can't be cancelled."
confirm = partial(approvals.confirm, actions=TEST_ACTIONS)
OUTCOME_UNKNOWN = (
    "We couldn't confirm whether this change went through. Use Try again; it won't "
    "be made twice."
)


def action_result(
    status: str,
    reference: str | None = None,
    acted_as: str | None = None,
    message: str | None = None,
) -> ActionResult:
    return ActionResult(
        status=status, reference=reference, acted_as=acted_as, message=message
    )


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


async def propose(request, recorder) -> str:
    await invoke(request, propose_rename, RENAME)
    return recorder.events[-1]["proposal_id"]


def key_for(session_id: str, proposal_id: str) -> str:
    return hashlib.sha256(f"{session_id}:{proposal_id}".encode()).hexdigest()


async def test_a_proposal_changes_nothing_and_asks_for_confirmation(
    request_context, recorder, action_calls
):
    output = await invoke(request_context, propose_rename, RENAME)

    proposal_id = recorder.events[0]["proposal_id"]
    assert recorder.events == [
        {
            "type": "confirmation_required",
            "proposal_id": proposal_id,
            "action": "rename_record",
            "args": RENAME,
            "arguments": RENAME,
        }
    ]
    assert action_calls.calls == []
    assert output == (
        "Nothing has changed yet. The user sees this change on a card to confirm."
    )


async def test_a_malformed_proposal_shows_no_card_and_names_the_fields(
    request_context, recorder
):
    output = await invoke(
        request_context,
        propose_rename,
        {"record_id": "1001", "name": "Archive", "amount": "1.234"},
    )

    assert recorder.events == []
    assert output == ("Not prepared, so no card was shown: check record_id, amount.")


async def test_a_proposal_missing_a_field_names_it(request_context, recorder):
    output = await invoke(
        request_context,
        propose_rename,
        {"record_id": "R-1001", "amount": "1.00"},
    )

    assert recorder.events == []
    assert output == "Not prepared, so no card was shown: check name."


async def test_a_proposal_without_a_step_label_names_it(request_context, recorder):
    text = json.dumps(RENAME)

    output = await propose_rename.on_invoke_tool(
        ToolContext(
            context=request_context,
            tool_name="propose_rename",
            tool_call_id="call-1",
            tool_arguments=text,
        ),
        text,
    )

    assert recorder.events == []
    assert output == "Not prepared, so no card was shown: check step."


async def test_approving_runs_the_action_as_the_user_with_its_key(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results.append(
        action_result(
            status="OK", reference="REF-1", acted_as="u@example.com", message="Done."
        )
    )

    reply = await confirm(request_context, proposal_id, "approve", recorder.events)

    assert action_calls.calls == [
        (
            "user",
            "rename_record",
            RENAME | {"idempotency_key": key_for("session-a", proposal_id)},
        )
    ]
    assert recorder.events[-1] == {
        "type": "tool_event",
        "at": ANY,
        "tool": "rename_record",
        "identity": "user",
        "target": RENAME_TARGET,
        "outcome": "allowed",
        "proposal_id": proposal_id,
        "status": "OK",
        "reference": "REF-1",
        "acted_as": "u@example.com",
    }
    assert reply == "Record renamed. Your reference is REF-1."


async def test_confirming_twice_sends_the_same_key_and_replays(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results += [
        action_result(
            status="OK", reference="REF-1", acted_as="u@example.com", message=""
        ),
        action_result(
            status="OK_REPLAYED",
            reference="REF-1",
            acted_as="u@example.com",
            message="",
        ),
    ]

    await confirm(request_context, proposal_id, "approve", recorder.events)
    replay = await confirm(request_context, proposal_id, "approve", recorder.events)

    first_key, second_key = (call[2]["idempotency_key"] for call in action_calls.calls)
    assert first_key == second_key
    assert replay == "This change was already made. Your reference is REF-1."


async def test_another_conversation_cannot_confirm_a_proposal(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)
    elsewhere = SimpleNamespace(events=[], modes=[])
    other = request_for("session-b", elsewhere)

    reply = await confirm(other, proposal_id, "approve", elsewhere.events)

    assert reply == NOT_FOUND
    assert elsewhere.events == []
    assert action_calls.calls == []


async def test_cancelling_runs_nothing_and_ends_the_proposal(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)

    reply = await confirm(request_context, proposal_id, "reject", recorder.events)
    later = await confirm(request_context, proposal_id, "approve", recorder.events)

    again = await confirm(request_context, proposal_id, "reject", recorder.events)

    assert reply == "Cancelled. Nothing was changed."
    assert later == again == ALREADY_CANCELLED
    assert [event["outcome"] for event in recorder.events[1:]] == ["rejected_by_user"]
    assert action_calls.calls == []


async def test_a_proposal_stays_open_after_a_failed_confirmation(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results += [
        ActionFailed("ended in state FAILED"),
        action_result(
            status="OK", reference="REF-1", acted_as="u@example.com", message=""
        ),
    ]

    with pytest.raises(approvals.ConfirmationFailed):
        await confirm(request_context, proposal_id, "approve", recorder.events)
    after_failure = approvals.stored_proposal(recorder.events, proposal_id)
    await confirm(request_context, proposal_id, "approve", recorder.events)

    first_key, second_key = (call[2]["idempotency_key"] for call in action_calls.calls)
    assert after_failure.outcome is None
    assert first_key == second_key
    assert approvals.stored_proposal(recorder.events, proposal_id).outcome == "allowed"


@pytest.mark.parametrize("status", ["OK", "OK_REPLAYED", "DENIED", "REJECTED"])
async def test_an_outcome_from_the_procedure_decides_a_proposal(
    request_context, recorder, action_calls, status
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results.append(
        action_result(status=status, reference="REF-1", acted_as=None, message="No.")
    )

    await confirm(request_context, proposal_id, "approve", recorder.events)

    outcome = "allowed" if status.startswith("OK") else "denied"
    assert approvals.stored_proposal(recorder.events, proposal_id).outcome == outcome


async def test_a_missing_grant_is_reported_as_denied(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)
    message = "[INSUFFICIENT_PERMISSIONS] User does not have EXECUTE on Routine."
    action_calls.results.append(
        action_result(status="DENIED", reference=None, acted_as=None, message=message)
    )

    reply = await confirm(request_context, proposal_id, "approve", recorder.events)

    assert recorder.events[-1] | {"proposal_id": None} == {
        "type": "tool_event",
        "at": ANY,
        "tool": "rename_record",
        "identity": "user",
        "target": RENAME_TARGET,
        "outcome": "denied",
        "proposal_id": None,
        "status": "DENIED",
    }
    assert "INSUFFICIENT_PERMISSIONS" not in str(recorder.events[-1])
    assert reply == "This change isn't permitted for you. Nothing was changed."


async def test_a_rule_failure_returns_the_procedure_message(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)
    message = "That name is taken by another of your records."
    action_calls.results.append(
        action_result(status="REJECTED", reference=None, acted_as=None, message=message)
    )

    reply = await confirm(request_context, proposal_id, "approve", recorder.events)

    assert (
        recorder.events[-1]["outcome"],
        recorder.events[-1]["status"],
        recorder.events[-1]["error"],
    ) == ("denied", "REJECTED", message)
    assert reply == f"{message} Nothing was changed."


async def test_a_procedure_permission_error_carries_no_raw_error_in_tool_event(
    request_context, recorder, action_calls
):
    """Procedure permission errors don't leak raw text in tool events."""
    proposal_id = await propose(request_context, recorder)
    action_calls.results.append(
        ActionFailed("PERMISSION_DENIED: User does not have EXECUTE on rename_record.")
    )

    with pytest.raises(approvals.ConfirmationFailed):
        await confirm(request_context, proposal_id, "approve", recorder.events)

    event = recorder.events[-1]
    assert event["outcome"] == "failed"
    assert "error" not in event
    assert "PERMISSION_DENIED" not in str(event)


@pytest.mark.parametrize(
    ("failure", "error", "reply"),
    [
        (
            ActionFailed("Connection refused"),
            "Connection refused",
            OUTCOME_UNKNOWN,
        ),
        (
            ConnectionError("Connection reset by peer"),
            "Connection reset by peer",
            OUTCOME_UNKNOWN,
        ),
        (
            ActionFailed("test_ops.rename_record ended in state FAILED on wh-1"),
            "test_ops.rename_record ended in state FAILED on wh-1",
            OUTCOME_UNKNOWN,
        ),
    ],
)
async def test_a_failed_call_raises_with_a_plain_reply_and_the_raw_error(
    request_context, recorder, action_calls, failure, error, reply
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results.append(failure)

    with pytest.raises(approvals.ConfirmationFailed) as raised:
        await confirm(request_context, proposal_id, "approve", recorder.events)

    assert (raised.value.reply, str(raised.value)) == (reply, error)
    assert recorder.events[-1] == {
        "type": "tool_event",
        "at": ANY,
        "tool": "rename_record",
        "identity": "user",
        "target": RENAME_TARGET,
        "outcome": "failed",
    }


async def test_a_cancel_after_the_procedures_outcome_runs_nothing(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results.append(
        action_result(
            status="OK", reference="REF-1", acted_as="u@example.com", message=""
        )
    )
    await confirm(request_context, proposal_id, "approve", recorder.events)
    events_before = list(recorder.events)

    reply = await confirm(request_context, proposal_id, "reject", recorder.events)

    assert reply == ALREADY_DECIDED
    assert recorder.events == events_before
    assert len(action_calls.calls) == 1


async def test_unknown_and_already_decided_replies_name_nothing_internal(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)

    replies = [
        await confirm(request_context, "unknown", "approve", recorder.events),
        await confirm(request_context, proposal_id, "reject", recorder.events),
        await confirm(request_context, proposal_id, "approve", recorder.events),
    ]

    assert replies[0] == NOT_FOUND
    assert [internal_names_in(reply) for reply in replies] == [[], [], []]


async def test_an_unknown_decision_is_refused(request_context):
    with pytest.raises(ValueError, match="approve' or 'reject'"):
        await confirm(request_context, "any", "maybe", [])


async def test_procedure_client_uses_user_client_not_app_client(
    request_context, recorder, monkeypatch
):
    proposal_id = await propose(request_context, recorder)
    used_clients = []

    class FakeProcedureClient:
        def __init__(self, workspace, warehouse_id, catalog, schema):
            used_clients.append(workspace.mode)

        def call(self, procedure, parameters):
            return action_result(
                status="OK", reference="REF-1", acted_as="u@example.com"
            )

    monkeypatch.setattr("agent.approvals.ProcedureClient", FakeProcedureClient)

    await confirm(request_context, proposal_id, "approve", recorder.events)

    assert used_clients == ["user"]


async def test_a_revoked_grant_comes_back_as_a_denied_result(
    request_context, recorder, action_calls
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results.append(
        action_result(
            status="DENIED",
            reference=None,
            acted_as=None,
            message="[INSUFFICIENT_PERMISSIONS] User does not have EXECUTE",
        )
    )

    reply = await confirm(request_context, proposal_id, "approve", recorder.events)

    assert reply == "This change isn't permitted for you. Nothing was changed."
    assert recorder.events[-1]["outcome"] == "denied"
    assert "INSUFFICIENT_PERMISSIONS" not in reply


async def test_a_real_cancellation_still_propagates(
    request_context, recorder, monkeypatch
):
    proposal_id = await propose(request_context, recorder)
    started = threading.Event()

    class SlowProcedureClient:
        def __init__(self, workspace, warehouse_id, catalog, schema):
            pass

        def call(self, procedure, parameters):
            started.set()
            time.sleep(0.5)

    monkeypatch.setattr(approvals, "ProcedureClient", SlowProcedureClient)
    task = asyncio.create_task(
        confirm(request_context, proposal_id, "approve", recorder.events)
    )
    await asyncio.to_thread(started.wait)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert [event["type"] for event in recorder.events] == ["confirmation_required"]


async def test_a_confirmation_logs_its_action_status_reference_and_duration(
    request_context, recorder, action_calls, caplog
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results.append(
        action_result(status="OK", reference="REF-1", acted_as="u", message=None)
    )

    with caplog.at_level(logging.INFO, logger="agent"):
        await confirm(request_context, proposal_id, "approve", recorder.events)

    (record,) = caplog.records
    assert (record.levelname, record.action, record.status, record.reference) == (
        "INFO",
        "rename_record",
        "OK",
        "REF-1",
    )
    assert isinstance(record.duration_ms, int)


async def test_a_failed_confirmation_logs_an_error_without_its_text(
    request_context, recorder, action_calls, caplog
):
    proposal_id = await propose(request_context, recorder)
    action_calls.results.append(ActionFailed(RAW_ERROR))

    with caplog.at_level(logging.INFO, logger="agent"):
        with pytest.raises(approvals.ConfirmationFailed):
            await confirm(request_context, proposal_id, "approve", recorder.events)

    (record,) = caplog.records
    assert (record.levelname, record.action, record.status, record.error) == (
        "ERROR",
        "rename_record",
        "OUTCOME_UNKNOWN",
        "ActionFailed",
    )
    assert RAW_ERROR not in repr(vars(record))
