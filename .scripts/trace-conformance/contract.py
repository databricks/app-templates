import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SpanManifest:
    name: str
    span_type: str
    span_id: str
    parent_span_id: str | None
    inputs: Any
    outputs: Any
    status: str
    latency_ms: float
    model: str | None
    provider: str | None
    usage: dict[str, int | float]
    cost_usd: float | None
    cost_available: bool
    links: list[dict[str, str]]
    attributes: dict[str, Any]


@dataclass
class TraceManifest:
    template: str
    trace_id: str
    spans: list[SpanManifest] = field(default_factory=list)


_SPAN_TYPES = {
    "AGENT",
    "CHAIN",
    "CHAT_MODEL",
    "EMBEDDING",
    "LLM",
    "MEMORY",
    "PARSER",
    "RETRIEVER",
    "TOOL",
}
_MODEL_TYPES = {"CHAT_MODEL", "LLM"}
_TERMINAL_STATUSES = {"OK", "SUCCESS", "ERROR", "CANCELLED"}
_IDENTITY_FIELDS = ("app_id", "user_id", "session_id")
_USAGE_FIELDS = ("input_tokens", "output_tokens", "total_tokens")
_SECRET_KEYS = {
    "accesstoken",
    "apikey",
    "authorization",
    "clientsecret",
    "cookie",
    "credential",
    "credentials",
    "databrickstoken",
    "password",
    "refreshtoken",
    "secret",
    "setcookie",
    "token",
    "xapikey",
}
_REDACTED = "[REDACTED]"


def _fail(
    trace: TraceManifest, span: SpanManifest, field_name: str, detail: str
) -> None:
    raise AssertionError(
        f"template={trace.template} span={span.name} field={field_name}: {detail}"
    )


def _has_value(value: Any) -> bool:
    return value is not None and value != "" and value != {} and value != []


def _normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _assert_redacted(trace: TraceManifest, span: SpanManifest, value: Any) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if _normalized_key(str(key)) in _SECRET_KEYS and nested != _REDACTED:
                _fail(trace, span, "credentials", f"{key} is not redacted")
            _assert_redacted(trace, span, nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            _assert_redacted(trace, span, nested)
    elif isinstance(value, str):
        leaked = re.search(
            r"(?i)\b(?:authorization|api[ _-]?key|password|secret|token|credentials?)\b"
            r"\s*(?::|=|is)?\s+(?:"
            r"Bearer\s+(?P<bearer_value>[^\s,;}]+)"
            r"|(?P<plain_value>(?!Bearer\b)[^\s,;}]+))",
            value,
        )
        captured = (
            leaked.group("bearer_value") or leaked.group("plain_value")
            if leaked
            else None
        )
        if captured and captured != _REDACTED:
            _fail(
                trace,
                span,
                "credentials",
                "captured text contains an unredacted secret",
            )


def _assert_usage(trace: TraceManifest, span: SpanManifest) -> None:
    for key in _USAGE_FIELDS:
        value = span.usage.get(key)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
            _fail(trace, span, f"usage.{key}", "must be a non-negative number")
    if span.usage["total_tokens"] < max(
        span.usage["input_tokens"], span.usage["output_tokens"]
    ):
        _fail(trace, span, "usage.total_tokens", "is smaller than a component")


def _assert_cost(trace: TraceManifest, span: SpanManifest) -> None:
    if not isinstance(span.cost_available, bool):
        _fail(trace, span, "cost_available", "must explicitly be true or false")
    if span.cost_available:
        if (
            not isinstance(span.cost_usd, (int, float))
            or isinstance(span.cost_usd, bool)
            or span.cost_usd < 0
        ):
            _fail(trace, span, "cost_usd", "available cost must be non-negative")
    elif span.cost_usd is not None:
        _fail(trace, span, "cost_usd", "unavailable cost must not be reported as zero")


def _assert_remote(trace: TraceManifest, span: SpanManifest) -> None:
    remote_trace_id = span.attributes.get("remote_trace_id")
    if not remote_trace_id:
        return
    remote_span_id = span.attributes.get("remote_span_id")
    if not remote_span_id:
        _fail(trace, span, "remote_span_id", "remote trace has no root span identity")
    if span.attributes.get("remote_lifecycle_complete") is not True:
        _fail(
            trace, span, "remote_lifecycle_complete", "remote lifecycle is incomplete"
        )
    if remote_trace_id == trace.trace_id:
        return
    expected = {"trace_id": remote_trace_id, "span_id": remote_span_id}
    if expected not in span.links:
        _fail(
            trace, span, "links", "orphan remote trace is neither continued nor linked"
        )


def assert_trace_contract(trace: TraceManifest) -> None:
    if not isinstance(trace.template, str) or not trace.template:
        raise AssertionError(
            "template=<unknown> span=<trace> field=template: missing template"
        )
    if not isinstance(trace.trace_id, str) or not trace.trace_id:
        raise AssertionError(
            f"template={trace.template} span=<trace> field=trace_id: missing trace identity"
        )
    if not trace.spans:
        raise AssertionError(
            f"template={trace.template} span=<trace> field=spans: trace has no spans"
        )

    parentless = [span for span in trace.spans if span.parent_span_id is None]
    if len(parentless) != 1 or parentless[0].span_type != "AGENT":
        culprit = parentless[-1] if parentless else trace.spans[0]
        _fail(
            trace, culprit, "AGENT root", "trace must have exactly one parentless AGENT"
        )
    root = parentless[0]

    span_ids: set[str] = set()
    for span in trace.spans:
        if not isinstance(span.name, str) or not span.name:
            _fail(trace, span, "name", "missing span name")
        if span.name != span.name.strip() or any(
            ord(character) < 32 for character in span.name
        ):
            _fail(trace, span, "name", "span name is not canonical")
        if span.span_type not in _SPAN_TYPES:
            _fail(
                trace,
                span,
                "span_type",
                f"unsupported semantic type {span.span_type!r}",
            )
        if not isinstance(span.span_id, str) or not span.span_id:
            _fail(trace, span, "span_id", "missing span identity")
        if span.span_id in span_ids:
            _fail(trace, span, "span_id", "duplicate span identity")
        span_ids.add(span.span_id)

        if not _has_value(span.inputs):
            _fail(trace, span, "inputs", "captured inputs are missing")
        if not _has_value(span.outputs):
            _fail(trace, span, "outputs", "captured outputs are missing")
        if span.status not in _TERMINAL_STATUSES:
            _fail(trace, span, "status", "span is not finalized with a terminal status")
        if (
            not isinstance(span.latency_ms, (int, float))
            or isinstance(span.latency_ms, bool)
            or span.latency_ms < 0
        ):
            _fail(trace, span, "latency_ms", "missing or invalid latency")
        if span.status == "ERROR" and not (
            isinstance(span.outputs, dict)
            and _has_value(span.outputs.get("partial_output"))
        ):
            _fail(trace, span, "outputs", "failed span must retain partial_output")
        _assert_cost(trace, span)
        _assert_remote(trace, span)
        _assert_redacted(trace, span, span.inputs)
        _assert_redacted(trace, span, span.outputs)
        _assert_redacted(trace, span, span.attributes)

    for span in trace.spans:
        if span is not root and span.parent_span_id not in span_ids:
            _fail(trace, span, "parent_span_id", "span has an orphan parent")

    spans_by_id = {span.span_id: span for span in trace.spans}
    for span in trace.spans:
        ancestry: set[str] = set()
        current = span
        while current.parent_span_id is not None:
            if current.span_id in ancestry:
                _fail(trace, span, "parent_span_id", "span ancestry contains a cycle")
            ancestry.add(current.span_id)
            current = spans_by_id[current.parent_span_id]

    model_spans = [span for span in trace.spans if span.span_type in _MODEL_TYPES]
    if not model_spans:
        _fail(trace, root, "semantic child", "trace has no model child")
    for span in model_spans:
        if not span.model:
            _fail(trace, span, "model", "model identity is missing")
        if not span.provider:
            _fail(trace, span, "provider", "provider identity is missing")
        _assert_usage(trace, span)
        if span.attributes.get("streaming") is True:
            for key in ("ttft_ms", "stream_duration_ms"):
                value = span.attributes.get(key)
                if (
                    not isinstance(value, (int, float))
                    or isinstance(value, bool)
                    or value < 0
                ):
                    _fail(trace, span, key, "stream timing is missing or invalid")

    for field_name in _IDENTITY_FIELDS:
        if not _has_value(root.attributes.get(field_name)):
            _fail(trace, root, field_name, "request identity is missing")

    _assert_usage(trace, root)
    for key in _USAGE_FIELDS:
        expected = sum(span.usage[key] for span in model_spans)
        if root.usage[key] != expected:
            _fail(
                trace,
                root,
                f"usage.{key}",
                f"aggregate {root.usage[key]!r} does not equal descendant total {expected!r}",
            )

    expected_cost_available = all(span.cost_available for span in model_spans)
    if root.cost_available != expected_cost_available:
        _fail(trace, root, "cost_available", "does not match descendant availability")
    if expected_cost_available:
        expected_cost = sum(float(span.cost_usd) for span in model_spans)
        if abs(float(root.cost_usd) - expected_cost) > 1e-12:
            _fail(trace, root, "cost_usd", "does not equal descendant cost total")
