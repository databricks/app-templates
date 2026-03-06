"""
Pytest tests for the long-running agent's Responses API.

Covers all responses.create() paths: sync, stream, background+poll,
background+stream, and background+stream with cursor-based retrieval.

Tests use a trivial prompt ("what time is it?") so they complete quickly.
The goal is to verify each API path works end-to-end, not to exercise
long-running behavior — background polling and streaming work the same
regardless of response length.

Note: client.responses.stream() is explicitly not tested here. That API
returns normalized event types that differ from the raw SSE events returned
by responses.create(stream=True), requiring complex event normalization
code to handle correctly. All streaming tests use responses.create() and
responses.retrieve() with stream=True instead.

Usage:
    # Start the server first
    uv run start-server --reload

    # Run all tests (server must be running on localhost:8000)
    uv run pytest scripts/test_long_running_agent.py -v

    # Run all tests in parallel
    uv run pytest scripts/test_long_running_agent.py -v -n auto

    # Single test
    uv run pytest scripts/test_long_running_agent.py -v -k test_background_stream_retrieve_with_cursor

    # Against deployed app
    AGENT_URL=https://my-app.databricksapps.com uv run pytest scripts/test_long_running_agent.py -v
"""

from __future__ import annotations

import os
import time

from openai import OpenAI
from databricks_openai import DatabricksOpenAI
from databricks.sdk import WorkspaceClient

AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:8000")

PROMPT = "What time is it?"


def get_client() -> OpenAI | DatabricksOpenAI:
    is_local = "localhost" in AGENT_URL or "127.0.0.1" in AGENT_URL
    if is_local:
        return OpenAI(base_url=AGENT_URL, api_key="local")
    return DatabricksOpenAI(workspace_client=WorkspaceClient(), base_url=AGENT_URL)


def _get_event_attr(evt: object, key: str, default=None):
    if isinstance(evt, dict):
        return evt.get(key, default)
    return getattr(evt, key, default)


def test_sync():
    """responses.create(stream=False) — basic synchronous call."""
    client = get_client()
    resp = client.responses.create(
        input=[{"role": "user", "content": PROMPT}],
    )
    assert resp.status == "completed"
    assert resp.output_text


def test_stream():
    """responses.create(stream=True) — streaming call, collect text deltas."""
    client = get_client()
    stream = client.responses.create(
        input=[{"role": "user", "content": PROMPT}],
        stream=True,
    )
    text_parts = []
    for event in stream:
        if _get_event_attr(event, "type") == "response.output_text.delta":
            delta = _get_event_attr(event, "delta")
            if delta:
                text_parts.append(delta)
    assert text_parts, "Expected text deltas from stream"


def test_background_poll():
    """responses.create(background=True, stream=False) + poll until completed."""
    client = get_client()
    resp = client.responses.create(
        input=[{"role": "user", "content": PROMPT}],
        background=True,
    )
    response_id = resp.id
    while resp.status in ("queued", "in_progress"):
        time.sleep(2)
        resp = client.responses.retrieve(response_id)
    assert resp.status == "completed"
    assert resp.output_text


def test_background_stream():
    """responses.create(background=True, stream=True) — iterate events."""
    client = get_client()
    stream = client.responses.create(
        input=[{"role": "user", "content": PROMPT}],
        background=True,
        stream=True,
    )
    text_parts = []
    for event in stream:
        if _get_event_attr(event, "type") == "response.output_text.delta":
            delta = _get_event_attr(event, "delta")
            if delta:
                text_parts.append(delta)
    assert text_parts, "Expected text deltas from background stream"


def test_background_stream_retrieve_with_cursor():
    """Background+stream, then retrieve with starting_after cursor to resume."""
    client = get_client()
    stream = client.responses.create(
        input=[{"role": "user", "content": PROMPT}],
        background=True,
        stream=True,
    )

    # Consume some events, track sequence_number as cursor
    response_id = None
    cursor = None
    events_before = 0
    for event in stream:
        seq = _get_event_attr(event, "sequence_number")
        if seq is not None:
            cursor = seq

        if response_id is None:
            resp = _get_event_attr(event, "response")
            if resp is not None:
                response_id = _get_event_attr(resp, "id")

        events_before += 1
        # Stop consuming after a few events so we can resume
        if events_before >= 5 and response_id and cursor is not None:
            break

    assert response_id, "Expected to get a response ID from initial stream"
    assert cursor is not None, "Expected to get a cursor from initial stream"

    # Resume from cursor
    resumed_stream = client.responses.retrieve(
        response_id,
        stream=True,
        starting_after=cursor,
    )
    text_parts = []
    for event in resumed_stream:
        seq = _get_event_attr(event, "sequence_number")
        # All events from resumed stream should be after our cursor
        if seq is not None:
            assert seq > cursor, f"Got event with seq {seq} <= cursor {cursor}"
        if _get_event_attr(event, "type") == "response.output_text.delta":
            delta = _get_event_attr(event, "delta")
            if delta:
                text_parts.append(delta)
    assert text_parts, "Expected text deltas from resumed stream"


def test_background_stream_retrieve_poll():
    """Background+stream to get response ID, then retrieve (poll) until completed."""
    client = get_client()
    stream = client.responses.create(
        input=[{"role": "user", "content": PROMPT}],
        background=True,
        stream=True,
    )

    # Get the response ID from initial events, then stop consuming
    response_id = None
    for event in stream:
        if response_id is None:
            resp = _get_event_attr(event, "response")
            if resp is not None:
                response_id = _get_event_attr(resp, "id")
        if response_id:
            break

    assert response_id, "Expected to get a response ID from stream"

    # Poll until completed (no stream)
    resp = client.responses.retrieve(response_id)
    while resp.status in ("queued", "in_progress"):
        time.sleep(2)
        resp = client.responses.retrieve(response_id)
    assert resp.status == "completed"
    assert resp.output_text
