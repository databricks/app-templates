"""Unit tests for the ADK <-> Responses adapter in agent_server/utils.py (no model required)."""

import asyncio
import json

from google.adk.events import Event
from google.adk.sessions import InMemorySessionService
from google.genai import types

from agent_server.utils import process_adk_events, seed_session_history

APP, USER, SESSION, AGENT = "test_app", "user-1", "session-1", "agent"


# --- helpers -----------------------------------------------------------------------------------


def _seed(messages):
    """Run seed_session_history and return (new_message, replayed session events)."""

    async def run():
        service = InMemorySessionService()
        new_message = await seed_session_history(
            service, APP, USER, SESSION, messages, agent_name=AGENT
        )
        session = await service.get_session(app_name=APP, user_id=USER, session_id=SESSION)
        return new_message, session.events

    return asyncio.run(run())


def _adapt(events):
    """Feed ADK events through process_adk_events and collect the emitted items."""

    async def stream():
        for e in events:
            yield e

    async def run():
        return [out async for out in process_adk_events(stream())]

    return asyncio.run(run())


def _call_event(name, call_id=None, args=None):
    return Event(
        author=AGENT,
        content=types.Content(
            role="model",
            parts=[types.Part(function_call=types.FunctionCall(name=name, args=args, id=call_id))],
        ),
    )


def _response_event(name, response, call_id=None):
    return Event(
        author=AGENT,
        content=types.Content(
            role="user",
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        name=name, response=response, id=call_id
                    )
                )
            ],
        ),
    )


def _items(outputs, item_type):
    return [o.item for o in outputs if o.type == "response.output_item.done" and o.item["type"] == item_type]


def _tool_output(response):
    """Return the function_call_output string emitted for a single tool response."""
    outputs = _adapt([_call_event("tool", "c1"), _response_event("tool", response, "c1")])
    [item] = _items(outputs, "function_call_output")
    return item["output"]


# --- seed_session_history ----------------------------------------------------------------------


def test_seed_replays_user_and_assistant_turns_and_returns_last_user_turn():
    new_message, events = _seed(
        [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello!"},
            {"role": "user", "content": [{"type": "input_text", "text": "what time is it?"}]},
        ]
    )

    assert [(e.author, e.content.role, e.content.parts[0].text) for e in events] == [
        ("user", "user", "hi"),
        (AGENT, "model", "hello!"),
    ]
    assert new_message.role == "user"
    assert new_message.parts[0].text == "what time is it?"


def test_seed_skips_system_and_tool_turns():
    _, events = _seed(
        [
            {"role": "system", "content": "be terse"},
            {"role": "user", "content": "hi"},
            {"role": "tool", "content": "tool output"},
            {"role": "user", "content": "again"},
        ]
    )

    assert [e.content.parts[0].text for e in events] == ["hi"]


def test_seed_uses_last_user_turn_when_input_ends_on_assistant():
    new_message, events = _seed(
        [
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": "reply"},
            {"role": "user", "content": "second"},
            {"role": "assistant", "content": "trailing reply"},
        ]
    )

    # The trailing assistant turn must never be handed to ADK as the user's new message.
    assert new_message.parts[0].text == "second"
    assert [e.content.parts[0].text for e in events] == ["first", "reply"]


def test_seed_falls_back_to_last_message_when_there_is_no_user_turn():
    new_message, events = _seed(
        [
            {"role": "assistant", "content": "earlier"},
            {"role": "assistant", "content": "latest"},
        ]
    )

    assert new_message.role == "user"
    assert new_message.parts[0].text == "latest"
    assert [e.content.parts[0].text for e in events] == ["earlier"]


def test_seed_handles_empty_input():
    new_message, events = _seed([])

    assert events == []
    assert new_message.parts[0].text == ""


# --- process_adk_events ------------------------------------------------------------------------


def test_null_function_call_id_gets_generated_id_shared_with_its_response():
    outputs = _adapt(
        [
            _call_event("get_current_time", call_id=None, args={"tz": "UTC"}),
            _response_event("get_current_time", {"result": "noon"}, call_id=None),
        ]
    )

    [call] = _items(outputs, "function_call")
    [result] = _items(outputs, "function_call_output")
    assert call["call_id"]
    assert call["call_id"] == result["call_id"]
    assert call["name"] == "get_current_time"
    assert json.loads(call["arguments"]) == {"tz": "UTC"}


def test_null_ids_pair_fifo_per_tool_name():
    outputs = _adapt(
        [
            _call_event("a"),
            _call_event("b"),
            _call_event("a"),
            _response_event("a", {"result": "a1"}),
            _response_event("b", {"result": "b1"}),
            _response_event("a", {"result": "a2"}),
        ]
    )

    calls = _items(outputs, "function_call")
    results = _items(outputs, "function_call_output")
    assert len({c["call_id"] for c in calls}) == 3
    by_id = {r["call_id"]: r["output"] for r in results}
    assert [by_id[c["call_id"]] for c in calls] == ["a1", "b1", "a2"]


def test_existing_function_call_ids_are_preserved():
    outputs = _adapt([_call_event("t", "call-123"), _response_event("t", {"result": "x"}, "call-123")])

    [call] = _items(outputs, "function_call")
    [result] = _items(outputs, "function_call_output")
    assert call["call_id"] == result["call_id"] == "call-123"


def test_single_result_key_with_string_unwraps_to_bare_string():
    assert _tool_output({"result": "x"}) == "x"


def test_single_result_key_with_non_string_is_json_dumped():
    assert json.loads(_tool_output({"result": {"rows": [1, 2]}})) == {"rows": [1, 2]}
    assert _tool_output({"result": 42}) == "42"


def test_multi_key_response_is_json_dumped():
    response = {"result": "x", "status": "ok"}
    assert json.loads(_tool_output(response)) == response


def test_partial_text_streams_as_deltas_then_final_message_item():
    partial = Event(
        author=AGENT,
        partial=True,
        content=types.Content(role="model", parts=[types.Part(text="Hel")]),
    )
    final = Event(
        author=AGENT,
        content=types.Content(
            role="model",
            parts=[types.Part(text="thinking...", thought=True), types.Part(text="Hello")],
        ),
    )

    outputs = _adapt([partial, final])

    assert [o.type for o in outputs] == ["response.output_text.delta", "response.output_item.done"]
    assert outputs[0].delta == "Hel"
    [message] = _items(outputs, "message")
    assert message["content"][0]["text"] == "Hello"  # thought part excluded
    assert outputs[0].item_id == message["id"]
