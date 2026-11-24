import json
import re
import time
import uuid

import httpx
import pytest
from use_case import (
    CHANGE_REQUEST,
    ONE_ROW_VALUE,
    OTHER_USERS_VALUE,
    OWN_ROWS_QUESTION,
    READ_TOOL,
    REFERENCE_QUESTION,
    REFERENCE_TOOL,
    REFERENCE_VALUE,
    ROWS_QUERY,
    WRITE_ACTION,
    WRITE_ARGUMENTS,
    WRITE_REQUEST,
    undo_write,
)

pytestmark = pytest.mark.user_scope

REJOIN_SECONDS = 300


def events_of(events: list[dict], kind: str) -> list[dict]:
    return [event for event in events if event["type"] == kind]


def reply(events: list[dict]) -> str:
    messages = [
        event["message"]["content"]
        for event in events_of(events, "message")
        if event["message"]["role"] == "assistant" and event["message"]["content"]
    ]
    return messages[-1]


def shown(events: list[dict]) -> str:
    """Answer and displays shown to user."""
    displays = [json.dumps(event["payload"]) for event in events_of(events, "display")]
    return "\n".join([reply(events), *displays])


def propose_write(agent) -> dict:
    events = agent.ask(WRITE_REQUEST)
    assert not [
        event
        for event in events_of(events, "tool_event")
        if event["tool"] == WRITE_ACTION
    ]
    return events_of(events, "confirmation_required")[0]


def confirm_after_rejoining(agent, proposal_id: str) -> dict:
    """Retry confirm until group membership updates, up to REJOIN_SECONDS."""
    deadline = time.monotonic() + REJOIN_SECONDS
    while True:
        event = events_of(agent.confirm(proposal_id), "tool_event")[-1]
        if event["outcome"] != "denied" or time.monotonic() > deadline:
            return event
        time.sleep(15)


def test_reads_run_as_the_signed_in_user(agent):
    events = agent.ask(OWN_ROWS_QUESTION)

    calls = events_of(events, "tool_event")
    assert {(call["tool"], call["outcome"]) for call in calls} >= {
        ("model", "allowed"),
        (READ_TOOL, "allowed"),
    }
    assert {call["identity"] for call in calls} == {"user"}
    assert re.search(ONE_ROW_VALUE, shown(events))
    assert not re.search(OTHER_USERS_VALUE, shown(events))
    assert events[-1]["type"] == "run.completed"


def test_reference_data_is_read_as_the_app(agent):
    events = agent.ask(REFERENCE_QUESTION)

    reads = [
        call
        for call in events_of(events, "tool_event")
        if call["tool"] == REFERENCE_TOOL
    ]
    assert [(call["identity"], call["outcome"]) for call in reads][:1] == [
        ("app", "allowed")
    ]
    assert REFERENCE_VALUE in shown(events)


def test_a_write_waits_for_confirmation_and_runs_once(agent, call, config):
    proposal = propose_write(agent)
    assert proposal["action"] == WRITE_ACTION
    assert {
        name: type(value)(proposal["args"][name])
        for name, value in WRITE_ARGUMENTS.items()
    } == WRITE_ARGUMENTS

    first = events_of(agent.confirm(proposal["proposal_id"]), "tool_event")[-1]
    try:
        replay = events_of(agent.confirm(proposal["proposal_id"]), "tool_event")[-1]

        assert (first["outcome"], first["status"], first["acted_as"]) == (
            "allowed",
            "OK",
            config["test_user_one_id"],
        )
        assert (replay["status"], replay["reference"]) == (
            "OK_REPLAYED",
            first["reference"],
        )
    finally:
        if first.get("status") == "OK":
            undo_write(call)


def test_only_the_proposing_conversation_can_confirm(agent, other_agent):
    proposal = propose_write(agent)

    elsewhere = other_agent.confirm(proposal["proposal_id"])
    cancelled = agent.confirm(proposal["proposal_id"], "reject")

    assert reply(elsewhere) == "We couldn't find that change. Nothing was changed."
    assert not events_of(elsewhere, "tool_event")
    assert events_of(cancelled, "tool_event")[-1]["outcome"] == "rejected_by_user"


def test_another_user_cannot_confirm_in_a_users_conversation(
    agent, user_two_agent, sql, schemas
):
    """User two cannot confirm on user one's session or affect their rows."""
    proposal = propose_write(agent)
    before = sql(ROWS_QUERY.format(data=schemas.data))
    user_two_agent.session_id = agent.session_id

    try:
        try:
            events = user_two_agent.confirm(proposal["proposal_id"])
        except httpx.HTTPStatusError as refused:
            assert refused.response.status_code in (403, 404)
        else:
            statuses = [
                event.get("status") for event in events_of(events, "tool_event")
            ]
            assert not {"OK", "OK_REPLAYED"} & set(statuses), statuses
        assert sql(ROWS_QUERY.format(data=schemas.data)) == before
    finally:
        agent.confirm(proposal["proposal_id"], "reject")


def test_the_agent_cannot_change_a_row_without_an_action(agent, sql, schemas):
    before = sql(ROWS_QUERY.format(data=schemas.data))

    events = agent.ask(CHANGE_REQUEST)

    assert not events_of(events, "confirmation_required")
    assert {call["tool"] for call in events_of(events, "tool_event")} <= {
        "model",
        READ_TOOL,
    }
    assert sql(ROWS_QUERY.format(data=schemas.data)) == before
    assert events[-1]["type"] == "run.completed"


def test_leaving_the_app_users_group_refuses_the_next_write_until_rejoined(
    agent, call, outside_app_users_group
):
    proposal = propose_write(agent)

    with outside_app_users_group():
        refused = agent.confirm(proposal["proposal_id"])
    allowed = confirm_after_rejoining(agent, proposal["proposal_id"])
    try:
        denied = events_of(refused, "tool_event")[-1]

        assert (denied["outcome"], denied["status"]) == ("denied", "DENIED")
        assert reply(refused) == (
            "This change isn't permitted for you. Nothing was changed."
        )
        assert (allowed["outcome"], allowed["status"]) == ("allowed", "OK")
    finally:
        if allowed.get("status") == "OK":
            undo_write(call)


def test_the_agent_app_refuses_requests_without_a_user_token(agent_app):
    response = httpx.post(
        f"{agent_app['url']}/api/invocations",
        json={"id": str(uuid.uuid4()), "session_id": "s", "input": {"messages": []}},
        timeout=30,
    )

    assert response.status_code in (302, 401, 403)
