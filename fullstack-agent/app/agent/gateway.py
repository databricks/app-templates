from collections.abc import AsyncIterator
from typing import Any

from databricks_openai import AsyncDatabricksOpenAI
from databricks_openai.utils.clients import AsyncDatabricksCompletions
from openai.resources.chat import AsyncChat
from openai.types.chat import ChatCompletionChunk

EPHEMERAL = {"type": "ephemeral"}
POLICY_BLOCK = "databricks_service_policy"


class PolicyBlocked(Exception):
    """A Unity Catalog service policy blocked the model call."""


def check_policy(response: Any) -> None:
    """Raise `PolicyBlocked` if a service policy blocked this response or chunk."""
    block = getattr(response, POLICY_BLOCK, None)
    if block is not None:
        raise PolicyBlocked(str(block))


def text_only(chunk: ChatCompletionChunk) -> ChatCompletionChunk:
    """Extract text from chunk's delta parts, move reasoning to reasoning_content."""
    for choice in chunk.choices:
        content = choice.delta.content
        if isinstance(content, list):
            text = "".join(
                part.get("text", "") for part in content if part.get("type") == "text"
            )
            reasoning = "".join(
                summary.get("text", "")
                for part in content
                if part.get("type") == "reasoning"
                for summary in part.get("summary", [])
            )
            choice.delta.content = text or None
            if reasoning:
                choice.delta.reasoning_content = reasoning
    return chunk


async def text_only_stream(stream: Any) -> AsyncIterator[ChatCompletionChunk]:
    """Stream text-only chunks, raising PolicyBlocked if a service policy blocks.
    A blocked stream is read to its end unsent first, so its traced call ends."""
    try:
        async for chunk in stream:
            try:
                check_policy(chunk)
            except PolicyBlocked:
                async for _ in stream:
                    pass
                raise
            yield text_only(chunk)
    finally:
        await stream.close()


def with_cached_instructions(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add cache control to system message for prompt caching."""
    if not messages or messages[0].get("role") != "system":
        return messages
    first, *rest = messages
    if not isinstance(first["content"], str):
        return messages
    text = {"type": "text", "text": first["content"], "cache_control": EPHEMERAL}
    return [{**first, "content": [text]}, *rest]


class GatewayCompletions(AsyncDatabricksCompletions):
    """Stream text only, cache instructions, and raise PolicyBlocked on blocks."""

    async def create(self, **kwargs: Any) -> Any:
        kwargs["messages"] = with_cached_instructions(kwargs["messages"])
        response = await super().create(**kwargs)
        if kwargs.get("stream"):
            return text_only_stream(response)
        check_policy(response)
        return response


class GatewayOpenAI(AsyncDatabricksOpenAI):
    """The Databricks OpenAI client, with chat completions from `GatewayCompletions`."""

    @property
    def chat(self) -> AsyncChat:
        chat = super().chat
        chat.completions = GatewayCompletions(client=self)
        return chat
