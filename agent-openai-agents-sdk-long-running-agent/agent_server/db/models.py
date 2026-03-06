"""SQLAlchemy models for long-running agent persistence.

Uses agent_server schema to keep agent tables separate from frontend (ai_chatbot).
"""

import time

from sqlalchemy import Float, ForeignKey, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Dedicated schema for agent tables (responses, messages)
AGENT_DB_SCHEMA = "agent_server"


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""

    pass


class Response(Base):
    """Response status tracking for background agent tasks."""

    __tablename__ = "responses"
    __table_args__ = {"schema": AGENT_DB_SCHEMA}

    response_id: Mapped[str] = mapped_column(Text, primary_key=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False, default=time.time)
    trace_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    messages = relationship("Message", back_populates="response", cascade="all, delete-orphan")


class Message(Base):
    """Stream events and output items for a response."""

    __tablename__ = "messages"
    __table_args__ = {"schema": AGENT_DB_SCHEMA}

    response_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey(f"{AGENT_DB_SCHEMA}.responses.response_id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    sequence_number: Mapped[int] = mapped_column(Integer, primary_key=True, nullable=False, default=0)
    item: Mapped[str | None] = mapped_column(Text, nullable=True)
    stream_event: Mapped[str | None] = mapped_column(Text, nullable=True)

    response = relationship("Response", back_populates="messages")
