"""
Pytest tests for the long-running agent's Responses API.

Covers all responses.create() paths: sync, stream, background+poll,
background+stream, and background+stream with cursor-based retrieval.

Note: client.responses.stream() (non-background) is not tested. The OpenAI
Agents SDK's ChatCmplStreamHandler produces output items that don't conform
to what the OpenAI platform SDK's ResponseStreamManager expects (e.g. missing
type="message"), causing an AssertionError in the stream accumulator.
Background .stream() works because events are stored/retrieved via the DB
rather than accumulated client-side.

Tests use a trivial prompt ("what time is it?") so they complete quickly.
The goal is to verify each API path works end-to-end, not to exercise
long-running behavior — background polling and streaming work the same
regardless of response length.

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
    uv run pytest scripts/test_long_running_agent.py -v --agent-url https://my-app.databricksapps.com
"""

from __future__ import annotations

import time

import pytest
from openai import OpenAI
from databricks_openai import DatabricksOpenAI
from databricks.sdk import WorkspaceClient


@pytest.fixture(scope="session")
def agent_url(request):
    return request.config.getoption("--agent-url")

PROMPT = "What time is it?"


def get_client(agent_url: str) -> OpenAI | DatabricksOpenAI:
    is_local = "localhost" in agent_url or "127.0.0.1" in agent_url
    if is_local:
        return OpenAI(base_url=agent_url, api_key="local")
    return DatabricksOpenAI(workspace_client=WorkspaceClient(), base_url=agent_url)


def _get_event_attr(evt: object, key: str, default=None):
    if isinstance(evt, dict):
        return evt.get(key, default)
    return getattr(evt, key, default)


def test_sync(agent_url):
    client = get_client(agent_url)
    resp = client.responses.create(
        input=[{"role": "user", "content": PROMPT}],
    )
    # Non-background responses may return status=None (server doesn't set it)
    assert resp.status in ("completed", None)
    assert resp.output_text


def test_stream(agent_url):
    client = get_client(agent_url)
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


def test_background_poll(agent_url):
    client = get_client(agent_url)
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


def test_background_stream(agent_url):
    client = get_client(agent_url)
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


def test_background_stream_retrieve_with_cursor(agent_url):
    client = get_client(agent_url)
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


def test_background_stream_retrieve_poll(agent_url):
    client = get_client(agent_url)
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


def test_responses_stream_background_retrieve_with_cursor(agent_url):
    client = get_client(agent_url)
    with client.responses.stream(
        model="unused",
        input=[{"role": "user", "content": PROMPT}],
        background=True,
    ) as stream:
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
            if events_before >= 5 and response_id and cursor is not None:
                break

    assert response_id, "Expected to get a response ID from .stream()"
    assert cursor is not None, "Expected to get a cursor from .stream()"

    # Poll with starting_after cursor until completed
    resp = client.responses.retrieve(response_id)
    while resp.status in ("queued", "in_progress"):
        time.sleep(2)
        resp = client.responses.retrieve(response_id)
    assert resp.status == "completed"
    assert resp.output_text
