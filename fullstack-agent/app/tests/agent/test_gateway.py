import pytest
from openai.types.chat import ChatCompletionChunk
from openai.types.chat.chat_completion_chunk import Choice, ChoiceDelta

from agent.agent import run_agent
from agent.gateway import PolicyBlocked, text_only_stream
from agent.models import allowed_models
from tests.conftest import agent_request, blocked_by_policy

REASONING = [
    {
        "type": "reasoning",
        "summary": [
            {"type": "summary_text", "text": "Checking the records.", "signature": ""}
        ],
    }
]


def chunk(content) -> ChatCompletionChunk:
    return ChatCompletionChunk.model_construct(
        id="chunk",
        object="chat.completion.chunk",
        created=0,
        model="sonnet_llm",
        choices=[
            Choice.model_construct(
                index=0, delta=ChoiceDelta.model_construct(content=content)
            )
        ],
    )


class FakeStream:
    def __init__(self, chunks: list[ChatCompletionChunk]) -> None:
        self.chunks = chunks
        self.closed = False

    async def __aiter__(self):
        for item in self.chunks:
            yield item

    async def close(self) -> None:
        self.closed = True


async def test_a_stream_keeps_text_and_takes_reasoning_parts_out_of_it():
    stream = FakeStream(
        [
            chunk("You have"),
            chunk(REASONING),
            chunk([{"type": "text", "text": " 3 records."}]),
        ]
    )

    contents = [
        item.choices[0].delta.content async for item in text_only_stream(stream)
    ]

    assert contents == ["You have", None, " 3 records."]
    assert stream.closed


async def test_a_thinking_summary_moves_to_reasoning_content():
    signature_only = [
        {
            "type": "reasoning",
            "summary": [{"type": "summary_text", "text": "", "signature": "abc"}],
        }
    ]
    stream = FakeStream([chunk(REASONING), chunk(signature_only)])

    deltas = [item.choices[0].delta async for item in text_only_stream(stream)]

    assert deltas[0].content is None
    assert deltas[0].reasoning_content == "Checking the records."
    assert getattr(deltas[1], "reasoning_content", None) is None


@pytest.mark.parametrize("model", allowed_models(), ids=lambda model: model.id)
async def test_a_service_policy_block_ends_any_models_run_before_its_text(
    streaming_model, model
):
    streaming_model.replies = [blocked_by_policy("Blocked by policy.")]
    texts = []

    with pytest.raises(PolicyBlocked):
        async with run_agent(
            [{"role": "user", "content": "Records?"}],
            request=agent_request("run-1"),
            model=model,
            effort="low",
        ) as result:
            async for event in result.stream_events():
                if event.type == "raw_response_event" and hasattr(event.data, "delta"):
                    texts.append(event.data.delta)

    assert texts == []
