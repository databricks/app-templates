import copy
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from contract import SpanManifest, TraceManifest, assert_trace_contract
from normalize import (
    normalize_appkit_otel_trace,
    normalize_mlflow_core_trace,
    normalize_python_mlflow_trace,
    normalize_uc_rows,
)


TRACE_ID = "0123456789abcdef0123456789abcdef"
REMOTE_TRACE_ID = "fedcba9876543210fedcba9876543210"


def _span(
    name,
    span_type,
    span_id,
    parent_span_id,
    *,
    inputs=None,
    outputs=None,
    status="OK",
    latency_ms=12.5,
    model=None,
    provider=None,
    usage=None,
    cost_usd=None,
    cost_available=False,
    links=None,
    attributes=None,
):
    return SpanManifest(
        name=name,
        span_type=span_type,
        span_id=span_id,
        parent_span_id=parent_span_id,
        inputs={"value": "input"} if inputs is None else inputs,
        outputs={"value": "output"} if outputs is None else outputs,
        status=status,
        latency_ms=latency_ms,
        model=model,
        provider=provider,
        usage={} if usage is None else usage,
        cost_usd=cost_usd,
        cost_available=cost_available,
        links=[] if links is None else links,
        attributes={} if attributes is None else attributes,
    )


def _manifest(*children, root_usage=None, root_cost=None, cost_available=False):
    usage = root_usage or {
        "input_tokens": 7,
        "output_tokens": 3,
        "total_tokens": 10,
    }
    root = _span(
        "request",
        "AGENT",
        "root",
        None,
        usage=usage,
        cost_usd=root_cost,
        cost_available=cost_available,
        attributes={
            "app_id": "test-app",
            "user_id": "user-123",
            "session_id": "session-456",
        },
    )
    return TraceManifest(
        template="fixture-template", trace_id=TRACE_ID, spans=[root, *children]
    )


def _model(
    *,
    span_id="model",
    parent_span_id="root",
    usage=None,
    cost_usd=None,
    cost_available=False,
    attributes=None,
):
    return _span(
        "model call",
        "CHAT_MODEL",
        span_id,
        parent_span_id,
        model="databricks-meta-llama-3-3-70b-instruct",
        provider="databricks",
        usage=usage or {"input_tokens": 7, "output_tokens": 3, "total_tokens": 10},
        cost_usd=cost_usd,
        cost_available=cost_available,
        attributes=attributes,
    )


def _valid_workloads():
    simple = _manifest(_model())

    tool = _span(
        "get weather",
        "TOOL",
        "tool",
        "root",
        inputs={"city": "San Francisco"},
        outputs={"temperature": 65},
    )
    tool_using = _manifest(_model(span_id="plan"), tool)

    retrieval = _span(
        "vector search",
        "RETRIEVER",
        "retriever",
        "root",
        inputs={"query": "refund policy"},
        outputs={"documents": ["Returns are accepted for 30 days."]},
    )
    rag = _manifest(retrieval, _model(parent_span_id="retriever"))

    remote = _span(
        "remote agent",
        "TOOL",
        "remote",
        "root",
        inputs={"request": "delegate"},
        outputs={"response": "complete"},
        links=[{"trace_id": REMOTE_TRACE_ID, "span_id": "0123456789abcdef"}],
        attributes={
            "remote_trace_id": REMOTE_TRACE_ID,
            "remote_span_id": "0123456789abcdef",
            "remote_lifecycle_complete": True,
        },
    )
    delegated = _manifest(_model(), remote)
    return [simple, tool_using, rag, delegated]


@pytest.mark.parametrize(
    "manifest",
    _valid_workloads(),
    ids=["simple", "tool-using", "retrieval-generation", "remote-agent"],
)
def test_contract_accepts_complete_workload_shapes(manifest):
    assert_trace_contract(manifest)


@pytest.mark.parametrize(
    ("mutation", "expected_span", "expected_field"),
    [
        ("root-only", "request", "semantic child"),
        ("missing-model-output", "model call", "outputs"),
        ("missing-model-usage", "model call", "usage"),
        ("false-zero-cost", "model call", "cost_usd"),
        ("orphan-remote", "get weather", "links"),
        ("incomplete-tool", "get weather", "outputs"),
        ("missing-identity", "request", "user_id"),
        ("duplicate-roots", "second request", "AGENT root"),
        ("unfinalized", "model call", "status"),
        ("failure-without-partial-output", "model call", "outputs"),
        ("wrong-aggregate-usage", "request", "usage.total_tokens"),
        ("credential-leak", "get weather", "credentials"),
    ],
)
def test_contract_rejects_incomplete_or_untruthful_traces(
    mutation, expected_span, expected_field
):
    manifest = _manifest(
        _model(),
        _span(
            "get weather",
            "TOOL",
            "tool",
            "root",
            inputs={"city": "San Francisco"},
            outputs={"temperature": 65},
        ),
    )
    if mutation == "root-only":
        manifest.spans = manifest.spans[:1]
    elif mutation == "missing-model-output":
        manifest.spans[1].outputs = None
    elif mutation == "missing-model-usage":
        manifest.spans[1].usage = {}
    elif mutation == "false-zero-cost":
        manifest.spans[1].cost_available = False
        manifest.spans[1].cost_usd = 0.0
    elif mutation == "orphan-remote":
        manifest.spans[2].attributes = {
            "remote_trace_id": REMOTE_TRACE_ID,
            "remote_span_id": "0123456789abcdef",
            "remote_lifecycle_complete": True,
        }
    elif mutation == "incomplete-tool":
        manifest.spans[2].outputs = None
    elif mutation == "missing-identity":
        del manifest.spans[0].attributes["user_id"]
    elif mutation == "duplicate-roots":
        manifest.spans.append(_span("second request", "AGENT", "root-2", None))
    elif mutation == "unfinalized":
        manifest.spans[1].status = None
    elif mutation == "failure-without-partial-output":
        manifest.spans[1].status = "ERROR"
        manifest.spans[1].outputs = {"error": "provider unavailable"}
    elif mutation == "wrong-aggregate-usage":
        manifest.spans[0].usage["total_tokens"] = 9
    elif mutation == "credential-leak":
        manifest.spans[2].inputs = {"Authorization": "Bearer provider-secret"}

    with pytest.raises(AssertionError) as error:
        assert_trace_contract(manifest)

    message = str(error.value)
    assert "fixture-template" in message
    assert expected_span in message
    assert expected_field in message


@pytest.mark.parametrize("missing_field", ["ttft_ms", "stream_duration_ms"])
def test_contract_rejects_streaming_model_without_complete_timing(missing_field):
    model = _model(
        attributes={"streaming": True, "ttft_ms": 4.5, "stream_duration_ms": 18.0}
    )
    del model.attributes[missing_field]

    with pytest.raises(AssertionError) as error:
        assert_trace_contract(_manifest(model))

    assert "fixture-template" in str(error.value)
    assert "model call" in str(error.value)
    assert missing_field in str(error.value)


def test_contract_accepts_truthful_available_cost_and_aggregates_it_once():
    first = _model(
        span_id="model-1",
        usage={"input_tokens": 4, "output_tokens": 1, "total_tokens": 5},
        cost_usd=0.01,
        cost_available=True,
    )
    second = _model(
        span_id="model-2",
        usage={"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
        cost_usd=0.02,
        cost_available=True,
    )
    manifest = _manifest(
        first,
        second,
        root_usage={"input_tokens": 7, "output_tokens": 3, "total_tokens": 10},
        root_cost=0.03,
        cost_available=True,
    )

    assert_trace_contract(manifest)


def test_contract_accepts_failed_span_with_bounded_partial_output():
    model = _model()
    model.status = "ERROR"
    model.outputs = {
        "partial_output": "The partial answer",
        "error": "provider unavailable",
    }
    manifest = _manifest(model)
    manifest.spans[0].status = "ERROR"
    manifest.spans[0].outputs = {
        "partial_output": "The partial answer",
        "error": "provider unavailable",
    }

    assert_trace_contract(manifest)


def _complete_attributes(span_type, *, root=False, streaming=False):
    attributes = {
        "mlflow.spanType": span_type,
        "mlflow.spanInputs": {"prompt": "hello"},
        "mlflow.spanOutputs": {"text": "hello back"},
        "mlflow.spanStatus": "OK",
        "mlflow.spanLatencyMs": 10.0,
        "appkit.cost.available": False,
    }
    if root:
        attributes.update(
            {
                "mlflow.trace.tokenUsage": {
                    "input_tokens": 7,
                    "output_tokens": 3,
                    "total_tokens": 10,
                },
                "app.id": "test-app",
                "user.id": "user-123",
                "session.id": "session-456",
            }
        )
    else:
        attributes.update(
            {
                "gen_ai.request.model": "test-model",
                "gen_ai.provider.name": "databricks",
                "mlflow.chat.tokenUsage": {
                    "input_tokens": 7,
                    "output_tokens": 3,
                    "total_tokens": 10,
                },
            }
        )
    if streaming:
        attributes.update(
            {
                "streaming": True,
                "gen_ai.latency.time_to_first_token_ms": 2.0,
                "gen_ai.latency.stream_ms": 8.0,
            }
        )
    return attributes


def test_normalizes_python_mlflow_without_losing_ids_or_links():
    link = {"trace_id": REMOTE_TRACE_ID, "span_id": "0123456789abcdef"}
    trace = SimpleNamespace(
        info=SimpleNamespace(trace_id=TRACE_ID),
        data=SimpleNamespace(
            spans=[
                SimpleNamespace(
                    trace_id=TRACE_ID,
                    span_id="root",
                    parent_id=None,
                    name="request",
                    span_type="AGENT",
                    inputs={"prompt": "hello"},
                    outputs={"text": "hello back"},
                    status="OK",
                    latency_ms=15.0,
                    links=[],
                    attributes=_complete_attributes("AGENT", root=True),
                ),
                SimpleNamespace(
                    trace_id=TRACE_ID,
                    span_id="model",
                    parent_id="root",
                    name="model call",
                    span_type="CHAT_MODEL",
                    inputs={"prompt": "hello"},
                    outputs={"text": "hello back"},
                    status="OK",
                    latency_ms=10.0,
                    links=[link],
                    attributes=_complete_attributes("CHAT_MODEL"),
                ),
            ]
        ),
    )

    manifest = normalize_python_mlflow_trace("python-template", trace)

    assert manifest.trace_id == TRACE_ID
    assert manifest.spans[1].span_id == "model"
    assert manifest.spans[1].parent_span_id == "root"
    assert manifest.spans[1].links == [link]
    assert_trace_contract(manifest)


def test_normalizes_mlflow_core_camel_case_shape():
    link = {"traceId": REMOTE_TRACE_ID, "spanId": "0123456789abcdef"}
    raw = {
        "info": {"traceId": TRACE_ID},
        "data": {
            "spans": [
                {
                    "traceId": TRACE_ID,
                    "spanId": "root",
                    "parentSpanId": None,
                    "name": "request",
                    "spanType": "AGENT",
                    "inputs": {"prompt": "hello"},
                    "outputs": {"text": "hello back"},
                    "status": "OK",
                    "latencyMs": 15.0,
                    "links": [],
                    "attributes": _complete_attributes("AGENT", root=True),
                },
                {
                    "traceId": TRACE_ID,
                    "spanId": "model",
                    "parentSpanId": "root",
                    "name": "model call",
                    "spanType": "CHAT_MODEL",
                    "inputs": {"prompt": "hello"},
                    "outputs": {"text": "hello back"},
                    "status": {"statusCode": "OK"},
                    "latencyMs": 10.0,
                    "links": [link],
                    "attributes": _complete_attributes("CHAT_MODEL"),
                },
            ]
        },
    }

    manifest = normalize_mlflow_core_trace("typescript-template", raw)

    assert manifest.trace_id == TRACE_ID
    assert manifest.spans[1].links == [
        {"trace_id": REMOTE_TRACE_ID, "span_id": "0123456789abcdef"}
    ]
    assert_trace_contract(manifest)


class _OtelSpan:
    def __init__(self, *, root):
        self.name = "request" if root else "model call"
        self.attributes = _complete_attributes(
            "AGENT" if root else "CHAT_MODEL", root=root, streaming=not root
        )
        self.status = SimpleNamespace(code=1)
        self.duration = [0, 15_000_000 if root else 10_000_000]
        self.parentSpanContext = None if root else SimpleNamespace(spanId="root")
        self.links = (
            []
            if root
            else [
                SimpleNamespace(
                    context=SimpleNamespace(
                        traceId=REMOTE_TRACE_ID, spanId="0123456789abcdef"
                    )
                )
            ]
        )
        self._span_context = SimpleNamespace(
            traceId=TRACE_ID, spanId="root" if root else "model"
        )

    def spanContext(self):
        return self._span_context


def test_normalizes_appkit_otel_shape_and_stream_timing():
    manifest = normalize_appkit_otel_trace(
        "appkit-agents", [_OtelSpan(root=True), _OtelSpan(root=False)]
    )

    assert manifest.trace_id == TRACE_ID
    assert manifest.spans[1].parent_span_id == "root"
    assert manifest.spans[1].attributes["ttft_ms"] == 2.0
    assert manifest.spans[1].attributes["stream_duration_ms"] == 8.0
    assert manifest.spans[1].links == [
        {"trace_id": REMOTE_TRACE_ID, "span_id": "0123456789abcdef"}
    ]
    assert_trace_contract(manifest)


def test_normalizes_production_appkit_identity_and_timing_aliases():
    root_attributes = _complete_attributes("AGENT", root=True)
    for key in ("app.id", "user.id", "session.id"):
        del root_attributes[key]
    root_attributes.update(
        {
            "appkit.app.name": "test-app",
            "mlflow.trace.user": "user-123",
            "mlflow.trace.session": "session-456",
        }
    )
    model_attributes = _complete_attributes("CHAT_MODEL")
    model_attributes.update(
        {
            "streaming": True,
            "appkit.ttft_ms": 2.0,
            "appkit.stream_duration_ms": 8.0,
        }
    )
    root = _OtelSpan(root=True)
    root.attributes = root_attributes
    model = _OtelSpan(root=False)
    model.attributes = model_attributes

    manifest = normalize_appkit_otel_trace("appkit-agents", [root, model])

    assert manifest.spans[0].attributes["app_id"] == "test-app"
    assert manifest.spans[0].attributes["user_id"] == "user-123"
    assert manifest.spans[0].attributes["session_id"] == "session-456"
    assert manifest.spans[1].attributes["ttft_ms"] == 2.0
    assert manifest.spans[1].attributes["stream_duration_ms"] == 8.0
    assert_trace_contract(manifest)


def test_normalizes_persisted_uc_rows_and_decodes_attributes():
    rows = [
        {
            "trace_id": TRACE_ID,
            "span_id": "root",
            "parent_span_id": None,
            "name": "request",
            "attributes": json.dumps(_complete_attributes("AGENT", root=True)),
        },
        {
            "trace_id": TRACE_ID,
            "span_id": "model",
            "parent_span_id": "root",
            "name": "model call",
            "attributes": _complete_attributes("CHAT_MODEL"),
        },
    ]

    manifest = normalize_uc_rows("deployed-template", rows)

    assert manifest.trace_id == TRACE_ID
    assert [span.span_id for span in manifest.spans] == ["root", "model"]
    assert_trace_contract(manifest)


def test_normalizer_does_not_mutate_provider_payloads():
    raw = {
        "info": {"traceId": TRACE_ID},
        "data": {
            "spans": [
                {
                    "traceId": TRACE_ID,
                    "spanId": "root",
                    "parentSpanId": None,
                    "name": "request",
                    "spanType": "AGENT",
                    "inputs": {"prompt": "hello"},
                    "outputs": {"text": "hello back"},
                    "status": "OK",
                    "latencyMs": 15.0,
                    "links": [],
                    "attributes": _complete_attributes("AGENT", root=True),
                },
                {
                    "traceId": TRACE_ID,
                    "spanId": "model",
                    "parentSpanId": "root",
                    "name": "model call",
                    "spanType": "CHAT_MODEL",
                    "inputs": {"prompt": "hello"},
                    "outputs": {"text": "hello back"},
                    "status": "OK",
                    "latencyMs": 10.0,
                    "links": [],
                    "attributes": _complete_attributes("CHAT_MODEL"),
                },
            ]
        },
    }
    before = copy.deepcopy(raw)

    normalize_mlflow_core_trace("typescript-template", raw)

    assert raw == before
