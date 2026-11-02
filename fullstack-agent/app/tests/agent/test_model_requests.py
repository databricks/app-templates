import dataclasses
import json
from types import SimpleNamespace

import httpx
import pytest
from agents import Runner, SQLiteSession
from databricks_openai.utils import clients

from agent.agent import HISTORY_TURNS, create_agent, instructions, run_config
from agent.context import RequestContext
from agent.gateway import GatewayOpenAI
from agent.models import Effort, Model, model_named

COMPLETION = {
    "id": "completion-1",
    "object": "chat.completion",
    "created": 0,
    "model": "sonnet_llm",
    "choices": [
        {
            "index": 0,
            "message": {"role": "assistant", "content": "You have 10 records."},
            "finish_reason": "stop",
        }
    ],
    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
}
SUMMARIZED = {"type": "adaptive", "display": "summarized"}


@pytest.fixture
def model_requests(monkeypatch) -> list[dict]:
    """The JSON bodies the agent sends to the model service, with a fixed answer."""
    bodies = []

    def answer(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=COMPLETION)

    monkeypatch.setattr(
        clients,
        "_get_authorized_async_http_client",
        lambda *_: httpx.AsyncClient(transport=httpx.MockTransport(answer)),
    )
    return bodies


async def ask(
    question: str,
    session: SQLiteSession | None = None,
    model: Model | None = None,
    effort: Effort = "low",
) -> None:
    """Run a question on the given model and effort level."""
    model = model or model_named(None)
    user = SimpleNamespace(
        config=SimpleNamespace(
            host="https://workspace.example.com",
            authenticate=lambda: {"Authorization": "Bearer user-token"},
        )
    )
    request = RequestContext(
        lambda mode: user, lambda event: None, "session-a", "run-1"
    )
    client = GatewayOpenAI(workspace_client=user, use_ai_gateway=True)
    agent = create_agent(request, client, model, effort)
    config = dataclasses.replace(run_config(model), tracing_disabled=True)
    await Runner.run(
        agent, question, context=request, session=session, run_config=config
    )


async def stored_session(turns: list[list[dict]]) -> SQLiteSession:
    session = SQLiteSession("session-a")
    await session.add_items([item for turn in turns for item in turn])
    return session


def questions(body: dict) -> list[str]:
    return [
        message["content"] for message in body["messages"] if message["role"] == "user"
    ]


async def test_a_model_call_caches_the_tools_and_instructions_with_one_breakpoint(
    model_requests,
):
    await ask("What are my records?")

    (body,) = model_requests
    assert body["messages"][0] == {
        "role": "system",
        "content": [
            {
                "type": "text",
                "text": instructions(),
                "cache_control": {"type": "ephemeral"},
            }
        ],
    }
    assert json.dumps(body).count("cache_control") == 1
    assert body["tools"]


@pytest.mark.parametrize(
    ("model_id", "effort", "thinking", "output_config"),
    [
        ("sonnet_llm", "low", {"type": "between_tools"}, None),
        ("sonnet_llm", "high", SUMMARIZED, {"effort": "high"}),
        ("opus_llm", "low", SUMMARIZED, {"effort": "low"}),
    ],
)
async def test_a_claude_call_thinks_as_its_model_and_effort_allow(
    model_requests, model_id, effort, thinking, output_config
):
    await ask("What are my records?", model=model_named(model_id), effort=effort)

    (body,) = model_requests
    assert body["thinking"] == thinking
    assert body.get("output_config") == output_config


async def test_a_200_item_session_sends_only_its_last_turns_from_a_question(
    model_requests,
):
    session = await stored_session(
        [
            [
                {"role": "user", "content": f"Question {turn}"},
                {"role": "assistant", "content": f"Answer {turn}"},
            ]
            for turn in range(100)
        ]
    )

    await ask("New question", session)

    (body,) = model_requests
    assert body["messages"][1]["role"] == "user"
    assert questions(body) == [
        *(f"Question {turn}" for turn in range(100 - HISTORY_TURNS, 100)),
        "New question",
    ]


async def test_a_short_session_is_sent_whole(model_requests):
    session = await stored_session(
        [
            [
                {"role": "user", "content": f"Question {turn}"},
                {"role": "assistant", "content": f"Answer {turn}"},
            ]
            for turn in range(3)
        ]
    )

    await ask("New question", session)

    (body,) = model_requests
    assert questions(body) == ["Question 0", "Question 1", "Question 2", "New question"]


async def test_the_history_never_sends_a_tool_call_without_its_output(model_requests):
    session = await stored_session(
        [
            [
                {"role": "user", "content": f"Question {turn}"},
                {
                    "type": "function_call",
                    "call_id": f"call-{turn}",
                    "name": "get_records",
                    "arguments": "{}",
                },
                {
                    "type": "function_call_output",
                    "call_id": f"call-{turn}",
                    "output": "[]",
                },
                {"role": "assistant", "content": f"Answer {turn}"},
            ]
            for turn in range(HISTORY_TURNS + 5)
        ]
    )

    await ask("New question", session)

    (body,) = model_requests
    calls = [
        call["id"]
        for message in body["messages"]
        for call in message.get("tool_calls") or []
    ]
    outputs = [
        message["tool_call_id"]
        for message in body["messages"]
        if message["role"] == "tool"
    ]
    assert len(calls) == HISTORY_TURNS
    assert calls == outputs


@pytest.mark.parametrize(
    ("model_id", "sent"), [("opus_llm", True), ("sonnet_llm", False)]
)
async def test_an_earlier_image_reaches_only_a_model_that_reads_images(
    model_requests, model_id, sent
):
    image = {"type": "input_image", "image_url": "data:image/png;base64,iVBORw0KGgo="}
    session = await stored_session(
        [
            [
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": "Read this."}, image],
                },
                {"role": "assistant", "content": "It says hello."},
            ]
        ]
    )

    await ask("And now?", session, model_named(model_id))

    (body,) = model_requests
    assert ("data:image/png" in json.dumps(body)) is sent
    assert ("attached earlier" in json.dumps(body)) is not sent
