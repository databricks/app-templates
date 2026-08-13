"""Tracing configuration and request identity for the OpenAI Agents template."""

from __future__ import annotations

import hashlib
import importlib
import json
import math
import os
import re
import threading
import time
import weakref
from contextvars import ContextVar
from dataclasses import asdict, is_dataclass
from typing import Any, Mapping

import mlflow

_configuration_lock = threading.Lock()
_configured = False
_request_identity: ContextVar[dict[str, str] | None] = ContextVar(
    "appkit_request_identity", default=None
)
_request_traces: dict[str, "AgentRequestUsage"] = {}
_request_traces_lock = threading.Lock()
_model_timings: dict[str, dict[str, Any]] = {}
_model_timings_lock = threading.Lock()
_stream_capture: ContextVar[BoundedTraceAccumulator | None]
_MAX_CAPTURE_BYTES = 64 * 1024
_MAX_STREAM_PREVIEW_BYTES = _MAX_CAPTURE_BYTES // 2
_SECRET_KEY = re.compile(
    r"(?:authorization|api[-_]?key|cookie|credential|password|secret|token)",
    re.IGNORECASE,
)
_SECRET_LABEL = r"(?:authorization|api[-_]?key|cookie|credential|password|secret|token)"
_QUOTED_SECRET_TEXT = re.compile(
    rf"(?P<prefix>\b{_SECRET_LABEL}\b\s*(?::|=)\s*)"
    r"""(?P<value>'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")""",
    re.IGNORECASE,
)
_EXPLICIT_BEARER_SECRET_TEXT = re.compile(
    rf"(?P<prefix>\b{_SECRET_LABEL}\b\s*(?::|=)\s*bearer\s+)"
    r"(?P<value>[^\s,;)\]}]+)",
    re.IGNORECASE,
)
_UNQUOTED_SECRET_TEXT = re.compile(
    rf"(?P<prefix>\b{_SECRET_LABEL}\b\s*(?::|=)\s*)"
    r"""(?P<value>(?!(?:bearer)\b\s)[^\s,;)\]}"']+)""",
    re.IGNORECASE,
)
_STANDALONE_SECRET_TEXT = re.compile(
    r"(?P<prefix>\b(?:bearer|password|token|secret|api[-_]?key|authorization|credential|cookie)"
    r"\s+(?:bearer\s+)?)"
    r"(?P<value>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|[^\s,;)\]}\"']+)",
    re.IGNORECASE,
)


def _redact_secret_text(value: str) -> str:
    value = _QUOTED_SECRET_TEXT.sub(
        lambda match: (
            f"{match.group('prefix')}{match.group('value')[0]}"
            f"[REDACTED]{match.group('value')[-1]}"
        ),
        value,
    )
    value = _EXPLICIT_BEARER_SECRET_TEXT.sub(
        lambda match: f"{match.group('prefix')}[REDACTED]", value
    )
    value = _UNQUOTED_SECRET_TEXT.sub(
        lambda match: f"{match.group('prefix')}[REDACTED]", value
    )

    def redact_standalone(match: re.Match[str]) -> str:
        candidate = match.group("value")
        if candidate[:1] in {"'", '"'} and candidate[-1:] == candidate[:1]:
            redacted = f"{candidate[0]}[REDACTED]{candidate[-1]}"
        else:
            redacted = "[REDACTED]"
        return f"{match.group('prefix')}{redacted}"

    return _STANDALONE_SECRET_TEXT.sub(redact_standalone, value)


def _jsonable(value: Any) -> Any:
    try:
        if hasattr(value, "model_dump"):
            return _jsonable(value.model_dump())
        if is_dataclass(value) and not isinstance(value, type):
            return _jsonable(asdict(value))
        if isinstance(value, Mapping):
            return {
                str(key): "[REDACTED]"
                if _SECRET_KEY.search(str(key))
                else _jsonable(item)
                for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            }
        if isinstance(value, (list, tuple, set, frozenset)):
            return [_jsonable(item) for item in value]
        if isinstance(value, bytes):
            return _jsonable(value.decode("utf-8", errors="replace"))
        if isinstance(value, str):
            return _redact_secret_text(value)
        if value is None or isinstance(value, (bool, int, float)):
            return value
        return _redact_secret_text(repr(value))
    except BaseException as error:
        return f"<{type(value).__name__}: {type(error).__name__}>"


def safe_error_message(error: BaseException | str) -> str:
    """Return a bounded error message without credential values."""
    message = _redact_secret_text(str(error))
    if len(message.encode("utf-8")) <= 2048:
        return message
    return json.dumps(safe_trace_value(message, max_bytes=2048), sort_keys=True)


def safe_trace_value(value: Any, *, max_bytes: int = _MAX_CAPTURE_BYTES) -> Any:
    """Redact and deterministically bound an arbitrary trace value."""
    redacted = _jsonable(value)
    encoded = json.dumps(
        redacted, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    if len(encoded) <= max_bytes:
        return redacted
    preview_bytes = encoded[:max_bytes]
    while preview_bytes:
        try:
            preview = preview_bytes.decode("utf-8")
            break
        except UnicodeDecodeError:
            preview_bytes = preview_bytes[:-1]
    else:
        preview = ""
    return {
        "truncated": True,
        "originalBytes": len(encoded),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "preview": preview,
    }


class BoundedTraceAccumulator:
    """Capture a canonical JSON stream with bounded retained bytes."""

    def __init__(self, *, max_bytes: int = _MAX_STREAM_PREVIEW_BYTES):
        if max_bytes < 1:
            raise ValueError("max_bytes must be positive")
        self._max_bytes = max_bytes
        self._digest = hashlib.sha256()
        self._digest.update(b"[")
        self._original_bytes = 1
        self._preview = bytearray(b"[")
        self._items: list[Any] | None = []
        self._item_count = 0
        self._snapshot: list[Any] | dict[str, Any] | None = None

    def add(self, value: Any) -> None:
        if self._snapshot is not None:
            raise RuntimeError("cannot add values after capture is finalized")
        redacted = _jsonable(value)
        encoded = json.dumps(
            redacted, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        chunk = (b"," if self._item_count else b"") + encoded
        self._digest.update(chunk)
        self._original_bytes += len(chunk)
        remaining = self._max_bytes - len(self._preview)
        if remaining > 0:
            self._preview.extend(chunk[:remaining])
        if self._items is not None:
            if self._original_bytes + 1 <= self._max_bytes:
                self._items.append(redacted)
            else:
                self._items = None
        self._item_count += 1

    def snapshot(self) -> list[Any] | dict[str, Any]:
        if self._snapshot is None:
            self._digest.update(b"]")
            self._original_bytes += 1
            if len(self._preview) < self._max_bytes:
                self._preview.extend(b"]")
            if self._items is not None and self._original_bytes <= self._max_bytes:
                self._snapshot = self._items
            else:
                preview_bytes = bytes(self._preview)
                while preview_bytes:
                    try:
                        preview = preview_bytes.decode("utf-8")
                        break
                    except UnicodeDecodeError:
                        preview_bytes = preview_bytes[:-1]
                else:
                    preview = ""
                self._snapshot = {
                    "truncated": True,
                    "originalBytes": self._original_bytes,
                    "sha256": self._digest.hexdigest(),
                    "preview": preview,
                }
        return self._snapshot


_stream_capture = ContextVar("appkit_stream_capture", default=None)


def capture_stream_event(event: Any) -> None:
    if accumulator := _stream_capture.get():
        accumulator.add(event)


class TracedSession:
    """Trace memory operations that execute inside the semantic Runner root."""

    def __init__(self, session: Any):
        self._session = session

    def __getattr__(self, name: str) -> Any:
        return getattr(self._session, name)

    async def _call(self, name: str, method: Any, *args: Any, **kwargs: Any) -> Any:
        if mlflow.get_current_active_span() is None:
            return await method(*args, **kwargs)
        from mlflow.entities import SpanType

        manager = mlflow.start_span(name, span_type=SpanType.MEMORY)
        span = manager.__enter__()
        span.set_inputs(safe_trace_value({"args": args, "kwargs": kwargs}))
        try:
            result = await method(*args, **kwargs)
        except BaseException as error:
            safe_error = safe_error_message(error)
            partial_output = (
                {"items": []}
                if name == "memory.read"
                else {"completed": False}
            )
            span.set_outputs(
                {"error": safe_error, "partial_output": partial_output}
            )
            span.record_exception(RuntimeError(f"{type(error).__name__}: {safe_error}"))
            manager.__exit__(None, None, None)
            raise
        else:
            if name == "memory.read":
                outputs = {"items": safe_trace_value(result)}
            elif result is None:
                outputs = {"completed": True}
            else:
                outputs = {"result": safe_trace_value(result)}
            span.set_outputs(outputs)
            span.set_status("OK")
            manager.__exit__(None, None, None)
            return result

    async def get_items(self, *args: Any, **kwargs: Any) -> Any:
        return await self._call("memory.read", self._session.get_items, *args, **kwargs)

    async def add_items(self, *args: Any, **kwargs: Any) -> Any:
        return await self._call("memory.write", self._session.add_items, *args, **kwargs)

    async def pop_item(self, *args: Any, **kwargs: Any) -> Any:
        return await self._call("memory.write", self._session.pop_item, *args, **kwargs)

    async def clear_session(self, *args: Any, **kwargs: Any) -> Any:
        return await self._call("memory.write", self._session.clear_session, *args, **kwargs)


def configure_mlflow_tracing() -> None:
    """Configure MLflow's OpenAI integration exactly once per process."""
    global _configured
    if _configured:
        return
    with _configuration_lock:
        if _configured:
            return
        if tracking_uri := os.getenv("MLFLOW_TRACKING_URI"):
            mlflow.set_tracking_uri(tracking_uri)
        if experiment_id := os.getenv("MLFLOW_EXPERIMENT_ID"):
            mlflow.set_experiment(experiment_id=experiment_id)
        _install_mlflow_openai_hooks()
        mlflow.openai.autolog(log_traces=True)
        _install_single_mlflow_agent_processor()
        _configured = True


def set_request_trace_identity(
    session_id: str,
    user_id: str,
    request_id: str,
    template_name: str,
) -> None:
    """Attach request and agent identity before the OpenAI Runner executes."""
    identity = {
        "mlflow.trace.session": session_id,
        "mlflow.trace.user": user_id,
        "appkit.app.name": os.getenv("DATABRICKS_APP_NAME", template_name),
        "appkit.request.id": request_id,
        "template": template_name,
        "agent": "Agent",
    }
    _request_identity.set(identity)
    mlflow.update_current_trace(
        metadata={
            key: identity[key]
            for key in (
                "mlflow.trace.session",
                "mlflow.trace.user",
                "appkit.app.name",
                "appkit.request.id",
            )
        },
        tags={"template": identity["template"], "agent": identity["agent"]},
    )


class AgentRequestUsage:
    """Aggregate every local model call into one semantic AGENT root."""

    def __init__(self, span: Any):
        self._span = span
        self._input_tokens = 0
        self._output_tokens = 0
        self._total_tokens = 0
        self._cache_read_tokens = 0
        self._cache_creation_tokens = 0
        self._has_cache_read = False
        self._has_cache_creation = False
        self._model_calls = 0
        self._cost_available = True
        self._cost_usd = 0.0
        self._lock = threading.Lock()
        with _request_traces_lock:
            _request_traces[span.trace_id] = self

    def add(self, usage: Mapping[str, Any]) -> None:
        with self._lock:
            self._model_calls += 1
            self._input_tokens += _nonnegative_int(usage.get("inputTokens"))
            self._output_tokens += _nonnegative_int(usage.get("outputTokens"))
            self._total_tokens += _nonnegative_int(usage.get("totalTokens"))
            if usage.get("cacheReadInputTokens") is not None:
                self._has_cache_read = True
                self._cache_read_tokens += _nonnegative_int(
                    usage.get("cacheReadInputTokens")
                )
            if usage.get("cacheCreationInputTokens") is not None:
                self._has_cache_creation = True
                self._cache_creation_tokens += _nonnegative_int(
                    usage.get("cacheCreationInputTokens")
                )
            cost = usage.get("costUsd")
            if (
                usage.get("costAvailable") is not True
                or not isinstance(cost, (int, float))
                or isinstance(cost, bool)
                or not math.isfinite(cost)
                or cost < 0
            ):
                self._cost_available = False
            else:
                self._cost_usd += float(cost)

    def finalize(self) -> None:
        usage: dict[str, Any] = {
            "inputTokens": self._input_tokens,
            "outputTokens": self._output_tokens,
            "totalTokens": self._total_tokens,
            "costAvailable": self._model_calls > 0 and self._cost_available,
        }
        if self._has_cache_read:
            usage["cacheReadInputTokens"] = self._cache_read_tokens
        if self._has_cache_creation:
            usage["cacheCreationInputTokens"] = self._cache_creation_tokens
        if usage["costAvailable"]:
            usage["costUsd"] = round(self._cost_usd, 12)
        self._span.set_attribute("appkit.usage", usage)
        with _request_traces_lock:
            _request_traces.pop(self._span.trace_id, None)

    def partial_output(self) -> dict[str, int]:
        with self._lock:
            return {"model_calls_completed": self._model_calls}


def _nonnegative_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def _provider_cost(*values: Any) -> float | None:
    for value in values:
        if hasattr(value, "model_dump"):
            value = value.model_dump()
        if not isinstance(value, Mapping):
            continue
        for key in ("cost", "cost_usd", "total_cost_usd"):
            cost = value.get(key)
            if (
                isinstance(cost, (int, float))
                and not isinstance(cost, bool)
                and math.isfinite(cost)
                and cost >= 0
            ):
                return float(cost)
    return None


def _completion_usage(result: Any) -> dict[str, Any]:
    raw = getattr(result, "usage", None)
    if hasattr(raw, "model_dump"):
        usage = raw.model_dump()
    elif isinstance(raw, Mapping):
        usage = dict(raw)
    else:
        usage = {}
    input_tokens = usage.get("prompt_tokens", usage.get("input_tokens", 0))
    output_tokens = usage.get("completion_tokens", usage.get("output_tokens", 0))
    total_tokens = usage.get("total_tokens")
    if total_tokens is None:
        total_tokens = _nonnegative_int(input_tokens) + _nonnegative_int(output_tokens)
    details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}
    if hasattr(details, "model_dump"):
        details = details.model_dump()
    cost = _provider_cost(usage, getattr(result, "model_extra", None) or {})
    normalized: dict[str, Any] = {
        "inputTokens": _nonnegative_int(input_tokens),
        "outputTokens": _nonnegative_int(output_tokens),
        "totalTokens": _nonnegative_int(total_tokens),
        "costAvailable": cost is not None,
    }
    if isinstance(details, Mapping):
        if details.get("cached_tokens") is not None:
            normalized["cacheReadInputTokens"] = _nonnegative_int(
                details.get("cached_tokens")
            )
        if details.get("cache_write_tokens") is not None:
            normalized["cacheCreationInputTokens"] = _nonnegative_int(
                details.get("cache_write_tokens")
            )
    if cost is not None:
        normalized["costUsd"] = cost
    return normalized


def _model_finish_reason(result: Any) -> str | None:
    choices = getattr(result, "choices", None) or []
    return getattr(choices[0], "finish_reason", None) if choices else None


def _apply_identity_to_active_trace() -> None:
    if not (identity := _request_identity.get()):
        return
    mlflow.update_current_trace(
        metadata={
            key: identity[key]
            for key in (
                "mlflow.trace.session",
                "mlflow.trace.user",
                "appkit.app.name",
                "appkit.request.id",
            )
        },
        tags={"template": identity["template"], "agent": identity["agent"]},
    )


async def _appkit_patched_agent_run(original, self, *args, **kwargs):
    from mlflow.entities import SpanType
    from mlflow.openai import _agent_tracer
    from mlflow.tracing.fluent import start_span

    inputs, attributes = _agent_tracer._build_agent_run_span_args(
        original, self, args, kwargs
    )
    manager = start_span(
        name=_agent_tracer._AGENT_RUN_SPAN_NAME,
        span_type=SpanType.AGENT,
        attributes=attributes,
    )
    span = manager.__enter__()
    span.set_attribute(_agent_tracer._AGENT_RUN_ROOT_MARKER, True)
    span.set_inputs(safe_trace_value(inputs.get("input")))
    _apply_identity_to_active_trace()
    request_usage = AgentRequestUsage(span)
    try:
        result = await original(self, *args, **kwargs)
    except BaseException as error:
        safe_error = safe_error_message(error)
        span.set_outputs(
            {
                "error": safe_error,
                "partial_output": request_usage.partial_output(),
            }
        )
        span.record_exception(RuntimeError(f"{type(error).__name__}: {safe_error}"))
        request_usage.finalize()
        manager.__exit__(None, None, None)
        raise
    else:
        span.set_outputs(safe_trace_value(result.final_output))
        request_usage.finalize()
        span.set_status("OK")
        manager.__exit__(None, None, None)
        return result


def _finalize_appkit_streamed_root(
    span: Any,
    token: Any,
    request_usage: AgentRequestUsage,
    stream_capture: BoundedTraceAccumulator,
    *,
    error: BaseException | None = None,
    outputs: Any = None,
) -> None:
    from mlflow.openai import _agent_tracer

    _agent_tracer._safe_detach_span_context(token)
    try:
        request_usage.finalize()
        span.set_attribute("appkit.stream.capture", stream_capture.snapshot())
        if error is not None:
            safe_error = safe_error_message(error)
            span.set_outputs({"error": safe_error})
            span.record_exception(RuntimeError(f"{type(error).__name__}: {safe_error}"))
            span.set_status("ERROR")
        else:
            if outputs is not None:
                span.set_outputs(safe_trace_value(outputs))
            span.set_status("OK")
        span.end()
    except Exception:
        pass


def _appkit_patched_agent_run_streamed(original, self, *args, **kwargs):
    from mlflow.entities import SpanType
    from mlflow.openai import _agent_tracer
    from mlflow.tracing.fluent import start_span_no_context
    from mlflow.tracing.provider import set_span_in_context

    inputs, attributes = _agent_tracer._build_agent_run_span_args(original, self, args, kwargs)
    span = start_span_no_context(
        name=_agent_tracer._AGENT_RUN_STREAMED_SPAN_NAME,
        span_type=SpanType.AGENT,
        inputs=safe_trace_value(inputs.get("input")),
        attributes=attributes,
    )
    span.set_attribute(_agent_tracer._AGENT_RUN_ROOT_MARKER, True)
    token = set_span_in_context(span)
    _apply_identity_to_active_trace()
    request_usage = AgentRequestUsage(span)
    stream_capture = BoundedTraceAccumulator()
    try:
        result = original(self, *args, **kwargs)
    except BaseException as error:
        _finalize_appkit_streamed_root(
            span,
            token,
            request_usage,
            stream_capture,
            error=error,
        )
        raise
    finalizer = weakref.finalize(
        result,
        _finalize_appkit_streamed_root,
        span,
        token,
        request_usage,
        stream_capture,
    )
    original_stream_events = type(result).stream_events
    result_ref = weakref.ref(result)

    async def wrapped_stream_events(*stream_args, **stream_kwargs):
        live_result = result_ref()
        if not finalizer.alive:
            async for event in original_stream_events(live_result, *stream_args, **stream_kwargs):
                yield event
            return
        stream_capture_token = _stream_capture.set(stream_capture)
        error: BaseException | None = None
        try:
            async for event in original_stream_events(live_result, *stream_args, **stream_kwargs):
                yield event
        except BaseException as caught:
            error = caught
            raise
        finally:
            if finalizer.detach() is not None:
                _finalize_appkit_streamed_root(
                    span,
                    token,
                    request_usage,
                    stream_capture,
                    error=error,
                    outputs=None if error else live_result.final_output,
                )
            try:
                _stream_capture.reset(stream_capture_token)
            except (RuntimeError, ValueError):
                if _stream_capture.get() is stream_capture:
                    _stream_capture.set(None)

    result.stream_events = wrapped_stream_events
    return result


def _install_mlflow_openai_hooks() -> None:
    """Enrich the model spans emitted by MLflow's OpenAI autologger."""
    from mlflow.openai import _agent_tracer
    openai_autolog = importlib.import_module("mlflow.openai.autolog")

    _agent_tracer._patched_agent_run = _appkit_patched_agent_run
    _agent_tracer._patched_agent_run_streamed = _appkit_patched_agent_run_streamed
    original_start_span = openai_autolog._start_span
    original_end_success = openai_autolog._end_span_on_success
    original_add_event = openai_autolog._add_span_event

    def start_model_span(instance, inputs, run_id):
        span = original_start_span(instance, inputs, run_id)
        with _model_timings_lock:
            model = inputs.get("model")
            _model_timings[span.span_id] = {
                "started_ns": time.perf_counter_ns(),
                "first_token_ns": None,
                "model": model,
                "provider": "databricks"
                if str(model).startswith("databricks-")
                else "openai",
                "inputs": safe_trace_value(inputs),
            }
        return span

    def add_stream_event(span, index, chunk):
        with _model_timings_lock:
            timing = _model_timings.get(span.span_id)
            if timing is not None and timing["first_token_ns"] is None:
                timing["first_token_ns"] = time.perf_counter_ns()
        return original_add_event(span, index, safe_trace_value(chunk))

    def end_model_span(span, inputs, raw_result, is_responses_api):
        from openai import AsyncStream, Stream

        if isinstance(raw_result, (Stream, AsyncStream)):
            return original_end_success(
                span, inputs, raw_result, is_responses_api=is_responses_api
            )
        result = openai_autolog._try_parse_raw_response(raw_result)
        ended_ns = time.perf_counter_ns()
        with _model_timings_lock:
            timing = _model_timings.pop(span.span_id, {})
        started_ns = int(timing.get("started_ns") or ended_ns)
        first_token_ns = int(timing.get("first_token_ns") or ended_ns)
        usage = _completion_usage(result)
        with _request_traces_lock:
            request_usage = _request_traces.get(span.trace_id)
        if request_usage is not None:
            request_usage.add(usage)
        model = getattr(result, "model", None) or inputs.get("model")
        provider = "databricks" if str(model).startswith("databricks-") else "openai"
        attributes = {
            "mlflow.llm.model": model,
            "mlflow.llm.provider": provider,
            "mlflow.chat.tokenUsage": {
                "input_tokens": usage["inputTokens"],
                "output_tokens": usage["outputTokens"],
                "total_tokens": usage["totalTokens"],
            },
            "appkit.model": model,
            "appkit.provider": provider,
            "appkit.usage": usage,
            "appkit.ttft_ms": max(
                0.0, (first_token_ns - started_ns) / 1_000_000
            ),
            "appkit.stream_duration_ms": max(
                0.0, (ended_ns - started_ns) / 1_000_000
            ),
            "appkit.finish_reason": _model_finish_reason(result),
            "appkit.error": None,
            "appkit.cost_available": usage["costAvailable"],
        }
        if usage["costAvailable"]:
            attributes["appkit.cost_usd"] = usage["costUsd"]
            attributes["mlflow.llm.cost"] = {"total_cost": usage["costUsd"]}
        span.set_inputs(safe_trace_value(inputs))
        span.set_outputs(safe_trace_value(result))
        span.set_attributes(attributes)
        span.end()

    def end_model_error(span, error):
        ended_ns = time.perf_counter_ns()
        with _model_timings_lock:
            timing = _model_timings.pop(span.span_id, {})
        started_ns = int(timing.get("started_ns") or ended_ns)
        usage = {
            "inputTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0,
            "costAvailable": False,
        }
        with _request_traces_lock:
            request_usage = _request_traces.get(span.trace_id)
        if request_usage is not None:
            request_usage.add(usage)
        safe_error = safe_error_message(error)
        span.set_inputs(timing.get("inputs"))
        span.set_outputs({"error": safe_error})
        span.set_attributes(
            {
                "mlflow.llm.model": timing.get("model"),
                "mlflow.llm.provider": timing.get("provider"),
                "appkit.model": timing.get("model"),
                "appkit.provider": timing.get("provider"),
                "appkit.usage": usage,
                "appkit.ttft_ms": max(0.0, (ended_ns - started_ns) / 1_000_000),
                "appkit.stream_duration_ms": max(
                    0.0, (ended_ns - started_ns) / 1_000_000
                ),
                "appkit.finish_reason": "error",
                "appkit.error": safe_error,
                "appkit.cost_available": False,
            }
        )
        span.record_exception(RuntimeError(f"{type(error).__name__}: {safe_error}"))
        span.end()

    openai_autolog._start_span = start_model_span
    openai_autolog._add_span_event = add_stream_event
    openai_autolog._end_span_on_success = end_model_span
    openai_autolog._end_span_on_exception = end_model_error


def _install_single_mlflow_agent_processor() -> None:
    """Keep one MLflow processor and suppress duplicate generation spans."""
    from agents.tracing.setup import get_trace_provider
    from mlflow.openai._agent_tracer import (
        MlflowOpenAgentTracingProcessor,
        OpenAISpanType,
    )

    class AppKitMlflowProcessor(MlflowOpenAgentTracingProcessor):
        def __init__(self):
            super().__init__()
            self._ignored_generation_spans: set[str] = set()

        def on_span_start(self, span):
            if span.span_data.type == OpenAISpanType.GENERATION:
                self._ignored_generation_spans.add(span.span_id)
                return
            super().on_span_start(span)

        def on_span_end(self, span):
            if span.span_id in self._ignored_generation_spans:
                self._ignored_generation_spans.discard(span.span_id)
                return
            if span.span_data.type in {
                OpenAISpanType.AGENT,
                "task",
                "turn",
            }:
                from mlflow.entities import SpanEvent, SpanStatus, SpanStatusCode
                from mlflow.openai import _agent_tracer

                span_with_token = self._span_id_to_mlflow_span.pop(
                    span.span_id, None
                )
                if span_with_token is None:
                    return
                _agent_tracer.detach_span_from_context(span_with_token.token)
                mlflow_span = span_with_token.span
                agent_inputs = safe_trace_value(span.span_data.export())
                mlflow_span.set_inputs(agent_inputs)
                if span.span_data.type == OpenAISpanType.AGENT:
                    mlflow_span.set_attributes(
                        {
                            "handoffs": safe_trace_value(
                                span.span_data.handoffs
                            ),
                            "tools": safe_trace_value(span.span_data.tools),
                            "output_type": safe_trace_value(
                                span.span_data.output_type
                            ),
                        }
                    )
                if span.error:
                    safe_error = safe_error_message(
                        span.error.get("message", "error")
                    )
                    mlflow_span.set_outputs(
                        {
                            "error": safe_error,
                            "partial_output": agent_inputs,
                        }
                    )
                    mlflow_span.add_event(
                        SpanEvent(
                            name="exception",
                            attributes={
                                "exception.message": safe_error,
                                "exception.type": "",
                                "exception.stacktrace": json.dumps(
                                    safe_trace_value(
                                        span.error.get("data", {})
                                    )
                                ),
                            },
                        )
                    )
                    status = SpanStatus(
                        status_code=SpanStatusCode.ERROR,
                        description=safe_error,
                    )
                else:
                    outputs = (
                        {
                            "output_type": safe_trace_value(
                                span.span_data.output_type
                            )
                        }
                        if span.span_data.type == OpenAISpanType.AGENT
                        else {"completed": True}
                    )
                    mlflow_span.set_outputs(outputs)
                    status = SpanStatusCode.OK
                mlflow_span.end(status=status)
                return
            if span.error:
                span.set_error(
                    {
                        "message": safe_error_message(span.error.get("message", "error")),
                        "data": safe_trace_value(span.error.get("data", {})),
                    }
                )
            if span.span_data.type == OpenAISpanType.FUNCTION:
                span.span_data.input = json.dumps(safe_trace_value(span.span_data.input))
                span.span_data.output = safe_trace_value(span.span_data.output)
            super().on_span_end(span)

    processors = get_trace_provider()._multi_processor._processors
    non_mlflow = [
        processor
        for processor in processors
        if not isinstance(processor, MlflowOpenAgentTracingProcessor)
    ]
    get_trace_provider()._multi_processor._processors = [
        *non_mlflow,
        AppKitMlflowProcessor(),
    ]
