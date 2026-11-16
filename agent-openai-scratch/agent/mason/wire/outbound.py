"""Serialize the OpenAI Agents SDK's stream events to JSON dicts — no imposed wire contract.

``Runner.run_streamed().stream_events()`` yields SDK dataclasses that aren't JSON-serializable as-is
(``RawResponsesStreamEvent`` wraps a pydantic Responses event; ``RunItemStreamEvent`` wraps a
``RunItem``). This relays each one under its own ``type`` so the client receives the SDK's native
event shape, made JSON — nothing is reshaped into a different contract. ``AgentUpdatedStreamEvent``
carries a non-serializable ``Agent`` and isn't useful to a client, so it's skipped.
"""

from collections.abc import AsyncGenerator, AsyncIterator
from typing import Any


async def process_agent_stream_events(
    async_stream: AsyncIterator[Any],
) -> AsyncGenerator[dict, None]:
    """Yield each SDK stream event as a JSON-able dict tagged with its ``type``."""
    async for event in async_stream:
        if event.type == "raw_response_event":
            yield {"type": event.type, "data": event.data.model_dump()}
        elif event.type == "run_item_stream_event":
            yield {"type": event.type, "name": event.name, "item": event.item.to_input_item()}
