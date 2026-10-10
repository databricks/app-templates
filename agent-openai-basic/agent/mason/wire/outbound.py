"""Outbound wire translation: agent-SDK stream events -> Responses wire events.

Under the Responses API the SDK emits Responses-shaped ``raw_response_event``s with real ids, so
they pass straight through. The one thing the raw events do NOT carry is tool-call *outputs* (the
return value of a function tool) — those arrive as ``run_item_stream_event`` / ``tool_call_output_item``
— so we surface them as an explicit ``response.output_item.done``.
"""

from collections.abc import AsyncGenerator, AsyncIterator

from agents.result import StreamEvent
from mlflow.types.responses import ResponsesAgentStreamEvent


async def process_agent_stream_events(
    async_stream: AsyncIterator[StreamEvent],
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    """Relay Responses raw events as-is; surface tool outputs the raw stream omits."""
    async for event in async_stream:
        if event.type == "raw_response_event":
            yield event.data.model_dump()
        elif event.type == "run_item_stream_event" and event.item.type == "tool_call_output_item":
            yield ResponsesAgentStreamEvent(
                type="response.output_item.done",
                item=event.item.to_input_item(),
            )
