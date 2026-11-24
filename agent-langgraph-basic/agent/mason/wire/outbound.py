"""Outbound wire translation: LangGraph astream events -> Responses wire events.

LangGraph's ``astream(stream_mode=["updates", "messages"])`` yields two event shapes: ``updates``
(completed node outputs — full messages, incl. tool calls/results) and ``messages`` (token-level
chunks for streaming text). We map completed messages to Responses output items and text chunks to
text deltas.
"""

import json
import logging
from collections.abc import AsyncGenerator, AsyncIterator
from typing import Any

from langchain.messages import AIMessageChunk, ToolMessage
from mlflow.types.responses import (
    ResponsesAgentStreamEvent,
    create_text_delta,
    output_to_responses_items_stream,
)

logger = logging.getLogger(__name__)


async def process_agent_astream_events(
    async_stream: AsyncIterator[Any],
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    """Relay LangGraph stream events as Responses wire events."""
    async for event in async_stream:
        mode, payload = event[0], event[1]
        if mode == "updates":
            for node_data in payload.values():
                messages = node_data.get("messages", []) if isinstance(node_data, dict) else []
                for msg in messages:
                    # Tool results may carry non-string content; the Responses items stream needs str.
                    if isinstance(msg, ToolMessage) and not isinstance(msg.content, str):
                        msg.content = json.dumps(msg.content)
                for item in output_to_responses_items_stream(messages):
                    yield item
        elif mode == "messages":
            try:
                chunk = payload[0]
                if isinstance(chunk, AIMessageChunk) and (content := chunk.content):
                    yield ResponsesAgentStreamEvent(**create_text_delta(delta=content, item_id=chunk.id))
            except Exception:
                logger.exception("Error processing agent stream chunk")
