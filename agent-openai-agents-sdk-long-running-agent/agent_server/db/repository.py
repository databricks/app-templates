"""Async repository for responses and messages."""

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent_server.db.connection import get_async_session
from agent_server.db.models import Message, Response


async def create_response(response_id: str, status: str) -> None:
    """Insert a new response."""
    async with get_async_session() as session:
        session.add(Response(response_id=response_id, status=status))
        await session.commit()


async def update_response_status(response_id: str, status: str) -> None:
    """Update response status."""
    async with get_async_session() as session:
        result = await session.execute(select(Response).where(Response.response_id == response_id))
        row = result.scalar_one_or_none()
        if row:
            row.status = status
            await session.commit()


async def update_response_trace_id(response_id: str, trace_id: str) -> None:
    """Update response with trace_id (MLflow trace for observability)."""
    async with get_async_session() as session:
        result = await session.execute(select(Response).where(Response.response_id == response_id))
        row = result.scalar_one_or_none()
        if row:
            row.trace_id = trace_id
            await session.commit()


async def append_message(
    response_id: str,
    sequence_number: int,
    item: str | None = None,
    stream_event: dict[str, Any] | None = None,
) -> None:
    """Append a message (stream event) for a response."""
    async with get_async_session() as session:
        session.add(
            Message(
                response_id=response_id,
                sequence_number=sequence_number,
                item=item,
                stream_event=json.dumps(stream_event) if stream_event is not None else None,
            )
        )
        await session.commit()


async def get_messages(
    response_id: str,
    after_sequence: int | None = None,
) -> list[tuple[int, str | None, dict[str, Any] | None]]:
    """Fetch messages for a response, optionally after a sequence number.
    Returns list of (sequence_number, item, stream_event_dict).
    """
    async with get_async_session() as session:
        stmt = select(Message).where(Message.response_id == response_id)
        if after_sequence is not None:
            stmt = stmt.where(Message.sequence_number > after_sequence)
        stmt = stmt.order_by(Message.sequence_number)
        result = await session.execute(stmt)
        rows = result.scalars().all()
        out = []
        for r in rows:
            evt = json.loads(r.stream_event) if r.stream_event else None
            out.append((r.sequence_number, r.item, evt))
        return out


async def get_response(response_id: str) -> tuple[str, str, float, str | None] | None:
    """Fetch response metadata.

    Returns (response_id, status, created_at, trace_id) or None if not found.
    """
    async with get_async_session() as session:
        result = await session.execute(select(Response).where(Response.response_id == response_id))
        row = result.scalar_one_or_none()
        if row:
            return (row.response_id, row.status, row.created_at, row.trace_id)
        return None
