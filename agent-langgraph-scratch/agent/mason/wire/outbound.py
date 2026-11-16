"""Serialize LangGraph astream events to JSON dicts — the SDK's native shape, no imposed contract.

``astream(stream_mode=["updates", "messages"])`` yields two event shapes: ``updates`` (completed
node outputs — full LangChain messages, incl. tool calls/results) and ``messages`` (token-level
chunks for streaming text). We relay each as-is, made JSON: completed messages under
``{"type": "message", "message": <LangChain message dict>}`` and text chunks under
``{"type": "delta", "content": ..., "id": ...}``. Nothing is reshaped into the Responses contract —
the client receives LangGraph's native output. (The AgentServer-backed templates emit Responses-shaped
events; this from-scratch one shows the raw SDK shape instead.)
"""

import logging
from collections.abc import AsyncGenerator, AsyncIterator
from typing import Any

from langchain.messages import AIMessageChunk

logger = logging.getLogger(__name__)


async def process_agent_astream_events(
    async_stream: AsyncIterator[Any],
) -> AsyncGenerator[dict, None]:
    """Yield each LangGraph stream event as a JSON-able dict in LangChain's native shape."""
    async for event in async_stream:
        mode, payload = event[0], event[1]
        if mode == "updates":
            for node_data in payload.values():
                messages = node_data.get("messages", []) if isinstance(node_data, dict) else []
                for msg in messages:
                    yield {"type": "message", "message": msg.model_dump()}
        elif mode == "messages":
            try:
                chunk = payload[0]
                if isinstance(chunk, AIMessageChunk) and (content := chunk.content):
                    yield {"type": "delta", "content": content, "id": chunk.id}
            except Exception:
                logger.exception("Error processing agent stream chunk")
