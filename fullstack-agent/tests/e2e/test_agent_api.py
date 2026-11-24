import json
import re

import httpx
import pytest
from use_case import (
    OLD_ACTIVITY_ID,
    ONE_ROW_QUESTION,
    ONE_ROW_VALUE,
    READ_TOOL,
    RETRIED_ACTIVITY_ID,
    USER_ONE_ACTIVITY_PREFIX,
    USER_TWO_ACTIVITY_ID,
    USER_TWO_ACTIVITY_PREFIX,
)

pytestmark = pytest.mark.user_scope


def test_me_is_the_signed_in_user(api, config):
    me = api.get("/me").json()

    assert me["email"] == me["user_name"] == config["test_user_one_id"]


def test_a_new_conversation_holds_the_agent_transcript(api, agent):
    created = api.post("/sessions", json={"title": "Transcript check"}).json()
    agent.session_id = created["id"]

    agent.ask(ONE_ROW_QUESTION)

    listed = {item["id"]: item["title"] for item in api.get("/sessions").json()}
    assert listed[created["id"]] == "Transcript check"
    conversation = api.get(f"/sessions/{created['id']}").json()
    messages = conversation["messages"]
    assert messages[0] == {"role": "user", "content": ONE_ROW_QUESTION}
    assert messages[-1]["role"] == "assistant"
    displays = [
        json.dumps(event["data"]["payload"])
        for run in conversation["runs"]
        for event in run["events"]
        if event["type"] == "display"
    ]
    assert re.search(ONE_ROW_VALUE, "\n".join([messages[-1]["content"], *displays]))


def activity_ids(client) -> list[str]:
    return [row["activity_id"] for row in client.get("/activity").json()["rows"]]


def test_activity_lists_a_retried_row_once_and_only_the_last_90_days(api):
    ids = activity_ids(api)

    assert ids.count(RETRIED_ACTIVITY_ID) == 1
    assert OLD_ACTIVITY_ID not in ids
    assert not [
        activity_id
        for activity_id in ids
        if activity_id.startswith(USER_TWO_ACTIVITY_PREFIX)
    ]


def test_another_user_never_sees_a_users_activity(other_api):
    ids = activity_ids(other_api)

    assert USER_TWO_ACTIVITY_ID in ids
    assert not [
        activity_id
        for activity_id in ids
        if activity_id.startswith(USER_ONE_ACTIVITY_PREFIX)
    ]


def test_a_run_records_its_reads_in_activity(api, agent):
    created = api.post("/sessions", json={"title": "Activity check"}).json()
    agent.session_id = created["id"]

    agent.ask(ONE_ROW_QUESTION)

    rows = api.get("/activity").json()["rows"]
    reads = [
        row
        for row in rows
        if row["conversation_id"] == created["id"] and row["tool"] == READ_TOOL
    ]
    assert reads
    assert {row["conversation_title"] for row in reads} == {"Activity check"}
    assert all(row["outcome"] == "allowed" for row in reads)
    assert all(row["activity_id"].startswith(f"{row['run_id']}:") for row in reads)


def test_a_conversation_can_be_renamed_then_deleted(api):
    created = api.post("/sessions", json={"title": "Before the rename"}).json()
    path = f"/sessions/{created['id']}"

    renamed = api.patch(path, json={"title": "After the rename"})

    assert renamed.status_code == 200
    assert renamed.json()["title"] == "After the rename"
    listed = {item["id"]: item["title"] for item in api.get("/sessions").json()}
    assert listed[created["id"]] == "After the rename"
    assert api.get(path).json()["title"] == "After the rename"

    assert api.delete(path).status_code == 204
    assert api.get(path).status_code == 404


def test_an_unknown_conversation_is_not_found(api):
    assert api.get("/sessions/not-a-conversation").status_code == 404


def test_another_user_cannot_open_a_users_conversation(api, other_api):
    created = api.post("/sessions", json={"title": "My private conversation"}).json()

    assert other_api.get(f"/sessions/{created['id']}").status_code == 404


def test_another_user_cannot_see_a_users_conversations_in_list(api, other_api):
    created = api.post("/sessions", json={"title": "User one's conversation"}).json()

    user_one_conversations = [s["id"] for s in api.get("/sessions").json()]
    user_two_conversations = [s["id"] for s in other_api.get("/sessions").json()]

    assert created["id"] in user_one_conversations
    assert created["id"] not in user_two_conversations


def test_the_api_refuses_requests_without_a_user_token(agent_app):
    response = httpx.get(f"{agent_app['url']}/api/me", timeout=30)

    assert response.status_code in (302, 401, 403)


def test_compare_endpoint_returns_404(api):
    assert api.get("/compare").status_code == 404
