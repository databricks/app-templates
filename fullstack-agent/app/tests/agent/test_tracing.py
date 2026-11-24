"""Tracing: nothing reaches the OpenAI backend, and agent runs trace as expected."""

import json
import os
import warnings
from types import SimpleNamespace
from unittest.mock import patch

import mlflow
import pytest
from agents import ModelRefusalError
from mlflow.entities import SpanStatusCode, SpanType, TraceState
from mlflow.tracing.utils import TraceJSONEncoder
from openai.types.chat.chat_completion_chunk import ChoiceDelta

from agent.agent import configure, run_agent
from agent.gateway import PolicyBlocked
from agent.statement_execution import QueryFailed
from tests.conftest import (
    DEFAULT_MODEL,
    STEP,
    USER,
    agent_request,
    answers,
    asks_for,
    blocked_by_policy,
    model_chunk,
    spans_by_name,
    traced_run,
)

READ = {"step": STEP}
FILTERED = (
    model_chunk({"role": "assistant", "content": None}, "content_filter")
    + "data: [DONE]\n\n"
)
REFUSAL_METADATA = ("mlflow.trace.session", "mlflow.trace.user", "app.status")


@pytest.fixture(autouse=True)
def no_mlflow_env(monkeypatch):
    """Ensure no MLFLOW_* environment variables are set."""
    for key in list(os.environ.keys()):
        if key.startswith("MLFLOW_"):
            monkeypatch.delenv(key)


def test_configure_disables_openai_backend_exporter():
    """Verify configure() disables the default OpenAI trace exporter."""
    with patch("agent.agent.set_trace_processors") as mock_set:
        with patch("agent.agent.configure_tracing"):
            from agent.agent import configure

            configure()

            mock_set.assert_called_once_with([])


def test_set_trace_processors_is_called_before_configure_tracing():
    """Verify set_trace_processors([]) is called before configure_tracing()."""
    call_order = []

    def mock_set_trace_processors(processors):
        call_order.append("set_trace_processors")

    def mock_configure_tracing():
        call_order.append("configure_tracing")

    # Must patch where the functions are called (in agent.agent)
    with patch(
        "agent.agent.set_trace_processors", side_effect=mock_set_trace_processors
    ):
        with patch("agent.agent.configure_tracing", side_effect=mock_configure_tracing):
            from agent.agent import configure

            configure()

            assert call_order == ["set_trace_processors", "configure_tracing"]


def test_configure_silences_only_the_serializer_warning_on_list_content():
    reasoning = ChoiceDelta.model_construct(
        content=[{"type": "reasoning", "summary": [], "signature": ""}]
    )
    refusal = ChoiceDelta.model_construct(refusal=[{"type": "text"}])

    with (
        patch("agent.agent.set_trace_processors"),
        patch("agent.agent.configure_tracing"),
        warnings.catch_warnings(record=True) as caught,
    ):
        warnings.simplefilter("always")
        configure()
        json.dumps(reasoning, cls=TraceJSONEncoder)
        json.dumps(refusal, cls=TraceJSONEncoder)

    (warning,) = caught
    assert "field_name='refusal'" in str(warning.message)


async def test_an_agent_run_trace_has_the_session_user_and_its_spans(
    streaming_model, agent_traces, records
):
    trace = await traced_run(streaming_model, asks_for("read_records", READ))

    metadata = trace.info.trace_metadata
    assert (metadata["mlflow.trace.session"], metadata["mlflow.trace.user"]) == (
        "session-a",
        USER,
    )
    assert (metadata["app.version"], metadata["app.environment"]) == (
        "test-version",
        "test",
    )
    (root,) = [span for span in trace.data.spans if span.parent_id is None]
    spans = spans_by_name(trace)
    assert root.span_type == SpanType.AGENT
    assert spans["assistant"].span_type == SpanType.AGENT
    assert spans["read_records"].span_type == SpanType.TOOL
    assert not [s for s in trace.data.spans if s.name.lower() in ("task", "turn")]
    assert trace.info.state == TraceState.OK


async def test_a_run_sends_its_trace_id_for_feedback(
    streaming_model, agent_traces, records
):
    recorder = SimpleNamespace(events=[])
    streaming_model.replies = [answers("Done.")]

    async with run_agent(
        [{"role": "user", "content": "Records?"}],
        request=agent_request("run-1", recorder),
        model=DEFAULT_MODEL,
        effort="low",
    ) as result:
        async for _ in result.stream_events():
            pass

    trace_id = mlflow.get_last_active_trace_id()
    assert recorder.events == [{"type": "trace", "trace_id": trace_id}]


async def test_a_failed_read_marks_its_tool_span_error(
    streaming_model, agent_traces, records
):
    records.error = QueryFailed("FAILED: [INSUFFICIENT_PERMISSIONS] no SELECT")

    trace = await traced_run(streaming_model, asks_for("read_records", READ))

    span = spans_by_name(trace)["read_records"]
    assert span.status.status_code == SpanStatusCode.ERROR
    assert "INSUFFICIENT_PERMISSIONS" in str(
        [event.attributes for event in span.events]
    )


async def test_a_run_whose_consumer_fails_is_an_error_trace(
    streaming_model, agent_traces, records
):
    def fail_on_tool_output(event):
        if event.type == "run_item_stream_event" and event.name == "tool_output":
            raise RuntimeError("the stream to the user broke")

    with pytest.raises(RuntimeError):
        await traced_run(
            streaming_model,
            asks_for("read_records", READ),
            consume=fail_on_tool_output,
        )

    trace = mlflow.get_trace(mlflow.get_last_active_trace_id(), flush=True)
    assert trace.info.state == TraceState.ERROR


@pytest.mark.parametrize(
    ("reply", "refusal"),
    [
        (blocked_by_policy("Blocked by policy."), PolicyBlocked),
        (FILTERED, ModelRefusalError),
    ],
    ids=["service policy", "content filter"],
)
async def test_a_refused_run_is_an_ok_trace_with_its_links_and_status(
    streaming_model, agent_traces, records, reply, refusal
):
    with pytest.raises(refusal):
        await traced_run(streaming_model, reply)

    trace = mlflow.get_trace(mlflow.get_last_active_trace_id(), flush=True)
    (root,) = [span for span in trace.data.spans if span.parent_id is None]
    assert (trace.info.state, root.status.status_code) == (
        TraceState.OK,
        SpanStatusCode.OK,
    )
    metadata = trace.info.trace_metadata
    assert [metadata[key] for key in REFUSAL_METADATA] == [
        "session-a",
        USER,
        "POLICY_BLOCKED",
    ]
