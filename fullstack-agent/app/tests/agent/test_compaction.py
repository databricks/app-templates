import json
from types import SimpleNamespace

import httpx
import pytest
from agents import ModelRefusalError, SQLiteSession
from databricks.sdk.errors import DatabricksError
from databricks_openai.utils import clients
from openai import RateLimitError

from agent import compaction
from agent.agent import IMAGE_LEFT_OUT
from agent.compaction import SUMMARY_REQUEST, compact, split_history
from agent.gateway import PolicyBlocked
from agent.prompts import prompt
from tests.conftest import DEFAULT_MODEL, agent_request

SUMMARY = "The user has two records, R-1001 and R-1002, and renamed R-1001."


def question(text: str) -> dict:
    return {"role": "user", "content": text}


def answer(text: str) -> dict:
    return {"role": "assistant", "content": text}


CALL = {
    "type": "function_call",
    "call_id": "c1",
    "name": "read_records",
    "arguments": "{}",
}
OUTPUT = {
    "type": "function_call_output",
    "call_id": "c1",
    "output": '[{"id": "R-1001"}]',
}
HISTORY = [
    question("Which records do I have?"),
    CALL,
    OUTPUT,
    answer("R-1001 and R-1002."),
    question("Rename R-1001."),
    answer("Renamed."),
    question("And R-1002?"),
    answer("Which name?"),
]


@pytest.fixture
def model(monkeypatch) -> SimpleNamespace:
    """Mock model service returning SUMMARY or status; set blocked/filtered flags."""
    model = SimpleNamespace(requests=[], status=200, blocked=False, filtered=False)

    def respond(request: httpx.Request) -> httpx.Response:
        model.requests.append(json.loads(request.content))
        if model.status != 200:
            return httpx.Response(model.status, json={"error": {"message": "busy"}})
        block = {"databricks_service_policy": {"reason": "Blocked."}}
        return httpx.Response(
            200,
            json=(block if model.blocked else {})
            | {
                "id": "completion-1",
                "object": "chat.completion",
                "created": 0,
                "model": "sonnet_llm",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "content_filter" if model.filtered else "stop",
                        "message": {
                            "role": "assistant",
                            "content": None if model.filtered else SUMMARY,
                        },
                    }
                ],
                "usage": {
                    "prompt_tokens": 400,
                    "completion_tokens": 30,
                    "total_tokens": 430,
                },
            },
        )

    monkeypatch.setattr(
        clients,
        "_get_authorized_async_http_client",
        lambda *_: httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    return model


@pytest.fixture
def session(monkeypatch) -> SQLiteSession:
    """The conversation's session: an in-memory SQLite session."""
    session = SQLiteSession("session-a")
    monkeypatch.setattr(compaction, "session_store", lambda session_id, actor: session)
    return session


def test_the_last_two_questions_are_kept_whole():
    older, kept = split_history(HISTORY)

    assert older == HISTORY[:4]
    assert kept == HISTORY[4:]


def test_two_questions_or_fewer_leave_nothing_older():
    assert split_history(HISTORY[4:]) == ([], HISTORY[4:])


def test_an_earlier_summary_is_not_a_question():
    history = [question(SUMMARY_REQUEST), answer(SUMMARY), *HISTORY[4:]]

    assert split_history(history) == ([], history)


async def test_older_items_become_one_summary(model, session):
    await session.add_items(HISTORY)

    usage = await compact(agent_request("run-1"), DEFAULT_MODEL)

    assert await session.get_items() == [
        question(SUMMARY_REQUEST),
        answer(SUMMARY),
        *HISTORY[4:],
    ]
    assert (usage.prompt_tokens, usage.completion_tokens) == (400, 30)


async def test_the_summary_call_reads_only_the_older_items(model, session):
    await session.add_items(HISTORY)

    await compact(agent_request("run-1"), DEFAULT_MODEL)

    (sent,) = model.requests
    assert sent["model"] == "test_catalog.test_ops.sonnet_llm"
    assert sent["messages"][0]["content"][0]["text"] == prompt("compact")
    assert json.loads(sent["messages"][1]["content"]) == HISTORY[:4]
    assert "tools" not in sent


async def test_a_short_conversation_calls_no_model(model, session):
    await session.add_items(HISTORY[4:])

    assert await compact(agent_request("run-1"), DEFAULT_MODEL) is None
    assert model.requests == []
    assert await session.get_items() == HISTORY[4:]


async def test_a_refused_model_call_changes_nothing(model, session):
    model.status = 429
    await session.add_items(HISTORY)

    with pytest.raises(RateLimitError):
        await compact(agent_request("run-1"), DEFAULT_MODEL)

    assert await session.get_items() == HISTORY


async def test_a_failed_write_puts_the_old_items_back(model, session, monkeypatch):
    await session.add_items(HISTORY)
    add_items = session.add_items
    writes = []

    async def failing_once(items):
        writes.append(items)
        if len(writes) == 1:
            raise DatabricksError("store unavailable")
        await add_items(items)

    monkeypatch.setattr(session, "add_items", failing_once)

    with pytest.raises(DatabricksError):
        await compact(agent_request("run-1"), DEFAULT_MODEL)

    assert await session.get_items() == HISTORY


async def test_an_older_image_is_left_out_of_the_summary_call(model, session):
    image = {"type": "input_image", "image_url": "data:image/png;base64,AAAA"}
    text = {"type": "input_text", "text": "Which records do I have?"}
    await session.add_items([{"role": "user", "content": [text, image]}, *HISTORY[1:]])

    await compact(agent_request("run-1"), DEFAULT_MODEL)

    (sent,) = model.requests
    older = json.loads(sent["messages"][1]["content"])
    assert older[0]["content"] == [text, IMAGE_LEFT_OUT]


async def test_a_blocked_summary_call_changes_nothing(model, session):
    model.blocked = True
    await session.add_items(HISTORY)

    with pytest.raises(PolicyBlocked):
        await compact(agent_request("run-1"), DEFAULT_MODEL)

    assert await session.get_items() == HISTORY


async def test_a_content_filtered_summary_call_changes_nothing(model, session):
    model.filtered = True
    await session.add_items(HISTORY)

    with pytest.raises(ModelRefusalError):
        await compact(agent_request("run-1"), DEFAULT_MODEL)

    assert await session.get_items() == HISTORY
