import json
import os
from contextlib import contextmanager
from dataclasses import asdict
from functools import wraps
from pathlib import Path
from typing import Any, Iterable, Mapping

from contract import SpanManifest, TraceManifest


def _get(value: Any, *names: str, default: Any = None) -> Any:
    for name in names:
        if isinstance(value, Mapping) and name in value:
            return value[name]
        if hasattr(value, name):
            return getattr(value, name)
    return default


def _decode(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith(("{", "[")):
            try:
                return json.loads(stripped)
            except (TypeError, ValueError):
                return value
    return value


def _attributes(span: Any) -> dict[str, Any]:
    value = _get(span, "attributes", default={})
    value = _decode(value)
    return dict(value) if isinstance(value, Mapping) else {}


def _attribute(attributes: Mapping[str, Any], *names: str, default=None):
    for name in names:
        if name in attributes:
            return attributes[name]
    return default


def _status(span: Any, attributes: Mapping[str, Any]) -> str | None:
    value = _get(span, "status", default=None)
    if isinstance(value, Mapping):
        value = _get(value, "status_code", "statusCode", "code", default=None)
    elif value is not None and not isinstance(value, (str, int)):
        value = _get(value, "status_code", "statusCode", "code", default=value)
    if value is None:
        value = _attribute(
            attributes, "mlflow.spanStatus", "otel.status_code", "status", default=None
        )
    if isinstance(value, int):
        return {0: None, 1: "OK", 2: "ERROR"}.get(value)
    if value is None:
        return None
    normalized = str(value).upper()
    if normalized.endswith(".OK"):
        return "OK"
    if normalized.endswith(".ERROR"):
        return "ERROR"
    return {
        "STATUS_CODE_OK": "OK",
        "STATUS_CODE_ERROR": "ERROR",
        "UNSET": None,
    }.get(normalized, normalized)


def _latency_ms(span: Any, attributes: Mapping[str, Any]) -> float | None:
    direct = _get(span, "latency_ms", "latencyMs", "duration_ms", "durationMs")
    if direct is not None and not isinstance(direct, Mapping):
        return float(direct)
    attribute_value = _attribute(
        attributes,
        "mlflow.spanLatencyMs",
        "mlflow.spanLatency",
        "latency_ms",
        "duration_ms",
    )
    if attribute_value is not None:
        return float(attribute_value)
    duration = _get(span, "duration")
    if isinstance(duration, (list, tuple)) and len(duration) == 2:
        return float(duration[0]) * 1000 + float(duration[1]) / 1_000_000
    start = _get(span, "start_time_unix_nano", "startTimeUnixNano", "start_time_ns")
    end = _get(span, "end_time_unix_nano", "endTimeUnixNano", "end_time_ns")
    if start is not None and end is not None:
        return (float(end) - float(start)) / 1_000_000
    return None


def _span_context(span: Any) -> Any:
    method = _get(span, "spanContext", "span_context", default=None)
    return method() if callable(method) else method


def _ids(span: Any) -> tuple[str | None, str | None, str | None]:
    context = _span_context(span)
    trace_id = _get(span, "trace_id", "traceId") or _get(context, "trace_id", "traceId")
    span_id = _get(span, "span_id", "spanId") or _get(context, "span_id", "spanId")
    parent_context = _get(span, "parent_span_context", "parentSpanContext")
    parent_id = _get(span, "parent_id", "parent_span_id", "parentSpanId") or _get(
        parent_context, "span_id", "spanId"
    )
    return trace_id, span_id, parent_id


def _links(span: Any) -> list[dict[str, str]]:
    normalized = []
    for link in _get(span, "links", default=[]) or []:
        context = _get(link, "context", default=link)
        trace_id = _get(context, "trace_id", "traceId")
        span_id = _get(context, "span_id", "spanId")
        if trace_id is not None or span_id is not None:
            normalized.append({"trace_id": trace_id, "span_id": span_id})
    return normalized


def _usage(attributes: Mapping[str, Any], *, root: bool) -> dict[str, Any]:
    names = (
        (
            "mlflow.trace.tokenUsage",
            "mlflow.trace.token_usage",
            "appkit.usage",
            "token_usage",
        )
        if root
        else (
            "mlflow.chat.tokenUsage",
            "mlflow.chat.token_usage",
            "appkit.usage",
            "gen_ai.usage",
            "usage",
        )
    )
    value = _attribute(attributes, *names, default={})
    value = _decode(value)
    if not isinstance(value, Mapping):
        return {}
    aliases = {
        "input_tokens": (
            "input_tokens",
            "prompt_tokens",
            "inputTokens",
            "promptTokens",
        ),
        "output_tokens": (
            "output_tokens",
            "completion_tokens",
            "outputTokens",
            "completionTokens",
        ),
        "total_tokens": ("total_tokens", "totalTokens"),
    }
    result = {}
    for canonical, candidates in aliases.items():
        result[canonical] = next(
            (value[candidate] for candidate in candidates if candidate in value), None
        )
    return {key: nested for key, nested in result.items() if nested is not None}


def _normalize_attributes(attributes: dict[str, Any]) -> dict[str, Any]:
    result = dict(attributes)
    streaming = _attribute(attributes, "streaming", "gen_ai.response.streaming")
    if streaming is not None:
        result["streaming"] = streaming
    ttft = _attribute(
        attributes,
        "ttft_ms",
        "appkit.ttft_ms",
        "gen_ai.latency.time_to_first_token_ms",
        "mlflow.chat.ttft_ms",
    )
    if ttft is not None:
        result["ttft_ms"] = ttft
    stream_duration = _attribute(
        attributes,
        "stream_duration_ms",
        "appkit.stream_duration_ms",
        "gen_ai.latency.stream_ms",
        "mlflow.chat.stream_duration_ms",
    )
    if stream_duration is not None:
        result["stream_duration_ms"] = stream_duration
    identity_aliases = {
        "app_id": (
            "app_id",
            "app.id",
            "appkit.app.name",
            "mlflow.trace.app_id",
        ),
        "user_id": ("user_id", "user.id", "mlflow.trace.user", "mlflow.trace.user_id"),
        "session_id": (
            "session_id",
            "session.id",
            "mlflow.trace.session",
            "mlflow.trace.session_id",
        ),
    }
    for canonical, aliases in identity_aliases.items():
        value = _attribute(attributes, *aliases)
        if value is not None:
            result[canonical] = value
    return result


def _normalize_span(span: Any) -> tuple[str | None, SpanManifest]:
    attributes = _attributes(span)
    trace_id, span_id, parent_span_id = _ids(span)
    span_type = _get(span, "span_type", "spanType") or _attribute(
        attributes, "mlflow.spanType", "span_type"
    )
    span_type = _get(span_type, "value", default=span_type)
    normalized_attributes = _normalize_attributes(attributes)
    root = span_type == "AGENT" and parent_span_id is None
    inputs = _get(span, "inputs", default=None)
    if inputs is None:
        inputs = _attribute(attributes, "mlflow.spanInputs", "inputs")
    outputs = _get(span, "outputs", default=None)
    if outputs is None:
        outputs = _attribute(attributes, "mlflow.spanOutputs", "outputs")
    appkit_usage = _decode(_attribute(attributes, "appkit.usage", default={}))
    if not isinstance(appkit_usage, Mapping):
        appkit_usage = {}
    cost = _attribute(attributes, "mlflow.llm.cost", "appkit.cost_usd", "cost_usd")
    if cost is None:
        cost = _get(appkit_usage, "costUsd", "cost_usd")
    cost_available = _attribute(
        attributes,
        "appkit.cost.available",
        "appkit.cost_available",
        "mlflow.cost.available",
        "cost_available",
    )
    if cost_available is None:
        cost_available = _get(appkit_usage, "costAvailable", "cost_available")
    if cost_available is None:
        cost_available = cost is not None
    if cost_available is False:
        # Provider/autolog integrations sometimes emit a default zero cost even
        # when the production span explicitly records that pricing is unknown.
        # The explicit availability signal is authoritative; retaining that
        # synthetic zero would turn "unknown" into a false priced result.
        cost = None
    manifest = SpanManifest(
        name=_get(span, "name"),
        span_type=span_type,
        span_id=span_id,
        parent_span_id=parent_span_id,
        inputs=_decode(inputs),
        outputs=_decode(outputs),
        status=_status(span, attributes),
        latency_ms=_latency_ms(span, attributes),
        model=_attribute(
            attributes,
            "mlflow.chat.model",
            "gen_ai.request.model",
            "gen_ai.response.model",
            "appkit.model",
            "model",
        ),
        provider=_attribute(
            attributes,
            "mlflow.chat.provider",
            "gen_ai.provider.name",
            "gen_ai.system",
            "appkit.provider",
            "provider",
        ),
        usage=_usage(attributes, root=root),
        cost_usd=_cost_value(cost),
        cost_available=cost_available,
        links=_links(span),
        attributes=normalized_attributes,
    )
    return trace_id, manifest


def _cost_value(value: Any) -> float | None:
    value = _decode(value)
    if value is None:
        return None
    if isinstance(value, Mapping):
        value = _get(
            value,
            "cost_usd",
            "costUsd",
            "total_cost",
            "totalCost",
            "value",
            "amount",
        )
    if value is None:
        return None
    return float(value)


def _normalize(
    template: str, trace_id: str | None, spans: Iterable[Any]
) -> TraceManifest:
    normalized = []
    observed_trace_ids = set()
    for raw_span in spans:
        span_trace_id, span = _normalize_span(raw_span)
        normalized.append(span)
        if span_trace_id:
            observed_trace_ids.add(span_trace_id)
    if trace_id:
        observed_trace_ids.add(trace_id)
    if len(observed_trace_ids) != 1:
        raise AssertionError(
            f"template={template} span=<trace> field=trace_id: mixed or missing trace IDs "
            f"{sorted(observed_trace_ids)!r}"
        )
    return TraceManifest(
        template=template, trace_id=next(iter(observed_trace_ids)), spans=normalized
    )


def normalize_python_mlflow_trace(template: str, trace: Any) -> TraceManifest:
    info = _get(trace, "info", default={})
    data = _get(trace, "data", default={})
    trace_id = _get(info, "trace_id", "traceId")
    manifest = _normalize(template, trace_id, _get(data, "spans", default=[]))
    metadata = _get(info, "trace_metadata", "traceMetadata", default={})
    if isinstance(metadata, Mapping):
        roots = [span for span in manifest.spans if span.parent_span_id is None]
        if len(roots) == 1:
            roots[0].attributes.update(_normalize_attributes(dict(metadata)))
    return manifest


def normalize_mlflow_core_trace(template: str, trace: Any) -> TraceManifest:
    info = _get(trace, "info", default={})
    data = _get(trace, "data", default={})
    trace_id = _get(info, "trace_id", "traceId") or _get(trace, "trace_id", "traceId")
    return _normalize(template, trace_id, _get(data, "spans", default=[]))


def normalize_appkit_otel_trace(template: str, spans: Iterable[Any]) -> TraceManifest:
    return _normalize(template, None, spans)


def normalize_uc_rows(template: str, rows: Iterable[Any]) -> TraceManifest:
    rows = list(rows)
    trace_id = _get(rows[0], "trace_id", "traceId") if rows else None
    return _normalize(template, trace_id, rows)


def write_trace_manifest(path: Path | str, trace: TraceManifest) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(asdict(trace), indent=2, sort_keys=True) + "\n")


def load_trace_manifest(path: Path | str) -> TraceManifest:
    value = json.loads(Path(path).read_text())
    return TraceManifest(
        template=value["template"],
        trace_id=value["trace_id"],
        spans=[SpanManifest(**span) for span in value["spans"]],
    )


_TRACE_CAPTURE_ERRORS: list[str] = []
_PROCESS_TRACE_IDS: list[str] = []
_PROCESS_TRACE_LOCATIONS: dict[str, str] = {}


def _install_trace_id_recorder(mlflow) -> None:
    original_start_span = mlflow.start_span
    if getattr(original_start_span, "_trace_conformance_recorder", False):
        return

    @wraps(original_start_span)
    @contextmanager
    def recording_start_span(*args, **kwargs):
        with original_start_span(*args, **kwargs) as span:
            trace_id = getattr(span, "trace_id", None)
            if trace_id and trace_id not in _PROCESS_TRACE_IDS:
                _PROCESS_TRACE_IDS.append(trace_id)
                _PROCESS_TRACE_LOCATIONS[trace_id] = str(mlflow.get_tracking_uri())
            yield span

    recording_start_span._trace_conformance_recorder = True
    mlflow.start_span = recording_start_span


def _capture_active_pytest_trace() -> None:
    """Write the first production trace that satisfies the shared contract.

    This hook is activated only by ``run_local_trace_test`` in a child pytest
    process. The template's real deterministic test owns trace creation; this
    module only reads the resulting local MLflow store and normalizes it.
    """
    destination = os.environ.get("TRACE_CONFORMANCE_MANIFEST")
    template = os.environ.get("TRACE_CONFORMANCE_TEMPLATE")
    if not destination or not template or Path(destination).exists():
        return
    try:
        import mlflow

        from contract import assert_trace_contract

        tracking_uri = str(mlflow.get_tracking_uri())
        if tracking_uri.startswith("databricks"):
            return
        trace_id = mlflow.get_last_active_trace_id()
        if trace_id and trace_id not in _PROCESS_TRACE_IDS:
            _PROCESS_TRACE_IDS.append(trace_id)
            _PROCESS_TRACE_LOCATIONS[trace_id] = tracking_uri
        candidates = []
        for trace_id in reversed(_PROCESS_TRACE_IDS):
            from mlflow.tracing.trace_manager import InMemoryTraceManager

            with InMemoryTraceManager.get_instance().get_trace(trace_id) as pending:
                if pending is not None:
                    candidates.append(pending.to_mlflow_trace())
                    continue
            current_tracking_uri = str(mlflow.get_tracking_uri())
            try:
                mlflow.set_tracking_uri(_PROCESS_TRACE_LOCATIONS[trace_id])
                trace = mlflow.get_trace(trace_id, silent=True)
            finally:
                mlflow.set_tracking_uri(current_tracking_uri)
            if trace is not None:
                candidates.append(trace)
        for trace in candidates:
            manifest = normalize_python_mlflow_trace(template, trace)
            try:
                assert_trace_contract(manifest)
            except AssertionError as error:
                _TRACE_CAPTURE_ERRORS.append(str(error))
                continue
            write_trace_manifest(destination, manifest)
            return
    except Exception as error:
        _TRACE_CAPTURE_ERRORS.append(f"capture error: {type(error).__name__}: {error}")
        # Individual tests may not have created a trace yet. The session-finish
        # hook below fails closed if no later test produces a valid manifest.
        return


if os.environ.get("TRACE_CONFORMANCE_MANIFEST"):
    import mlflow
    import pytest

    _install_trace_id_recorder(mlflow)

    @pytest.hookimpl(hookwrapper=True)
    def pytest_runtest_call(item):
        outcome = yield
        if outcome.excinfo is None:
            _capture_active_pytest_trace()

    def pytest_sessionfinish(session, exitstatus):
        destination = Path(os.environ["TRACE_CONFORMANCE_MANIFEST"])
        if exitstatus == 0 and not destination.exists():
            session.exitstatus = pytest.ExitCode.TESTS_FAILED
            session.config.pluginmanager.get_plugin("terminalreporter").write_line(
                "trace conformance manifest was not produced by any deterministic test"
                + (
                    "; failures: " + " | ".join(dict.fromkeys(_TRACE_CAPTURE_ERRORS))
                    if _TRACE_CAPTURE_ERRORS
                    else ""
                ),
                red=True,
            )
