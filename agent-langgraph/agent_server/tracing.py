"""MLflow tracing primitives shared by the LangGraph request path."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from dataclasses import asdict, is_dataclass
from typing import Any, AsyncIterator, Iterator, Mapping

import mlflow
from mlflow.entities import SpanType
from mlflow.langchain import langchain_tracer as _mlflow_langchain_tracer

if not hasattr(_mlflow_langchain_tracer, "_appkit_original_tracer"):
    _mlflow_langchain_tracer._appkit_original_tracer = (
        _mlflow_langchain_tracer.MlflowLangchainTracer
    )
_MlflowLangchainTracer = _mlflow_langchain_tracer._appkit_original_tracer

_langchain_autolog = mlflow.langchain.autolog

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
    r"(?P<label>\b(?:bearer|password|token|secret|api[-_]?key|authorization|credential|cookie))"
    r"(?P<spacing>\s+)(?P<value>[^\s,;)\]}]+)",
    re.IGNORECASE,
)
_configuration_lock = threading.Lock()
_configured = False
_request_traces: dict[str, "AgentRequestTrace"] = {}
_request_traces_lock = threading.Lock()


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
        looks_opaque = (
            len(candidate) >= 16
            or any(character in candidate for character in "-._~+/=")
            or (
                len(candidate) >= 8
                and any(character.isalpha() for character in candidate)
                and any(character.isdigit() for character in candidate)
            )
        )
        if not looks_opaque:
            return match.group(0)
        return f"{match.group('label')}{match.group('spacing')}[REDACTED]"

    return _STANDALONE_SECRET_TEXT.sub(redact_standalone, value)


def configure_mlflow_tracing() -> None:
    """Configure MLflow and LangChain autologging once per process."""
    global _configured
    if _configured:
        return
    with _configuration_lock:
        if _configured:
            return
        mlflow.set_tracking_uri(os.getenv("MLFLOW_TRACKING_URI", "databricks"))
        mlflow.set_experiment(experiment_id=os.environ["MLFLOW_EXPERIMENT_ID"])
        _mlflow_langchain_tracer.MlflowLangchainTracer = LangChainUsageCallback
        _langchain_autolog(log_traces=True)
        _configured = True


def set_request_trace_identity(
    session_id: str,
    user_id: str,
    request_id: str,
    template_name: str,
) -> None:
    """Attach the request identity before graph execution begins."""
    mlflow.update_current_trace(
        metadata={
            "mlflow.trace.session": session_id,
            "mlflow.trace.user": user_id,
            "appkit.app.name": os.getenv("DATABRICKS_APP_NAME", template_name),
            "appkit.request.id": request_id,
        },
        tags={"template": template_name, "agent": "default"},
    )


def _jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return _jsonable(value.model_dump())
    if is_dataclass(value) and not isinstance(value, type):
        return _jsonable(asdict(value))
    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]" if _SECRET_KEY.search(str(key)) else _jsonable(item)
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


def safe_error_message(error: BaseException | str) -> str:
    """Return a bounded exception category without credential values."""
    message = str(error)
    message = _redact_secret_text(message)
    if len(message.encode("utf-8")) <= 2048:
        return message
    return json.dumps(safe_trace_value(message, max_bytes=2048), sort_keys=True)


def safe_trace_value(value: Any, *, max_bytes: int = _MAX_CAPTURE_BYTES) -> Any:
    """Redact secrets and capture a deterministic, UTF-8-safe bounded value."""
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
    """Incrementally capture a canonical JSON array with bounded retained bytes."""

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
        prefix = b"," if self._item_count else b""
        chunk = prefix + encoded
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


class AgentRequestTrace:
    """Mutable state for one semantic AGENT root."""

    def __init__(self, span: Any):
        self._span = span
        self._input_tokens = 0
        self._output_tokens = 0
        self._total_tokens = 0
        self._cache_read_tokens = 0
        self._cache_creation_tokens = 0
        self._has_cache_read = False
        self._has_cache_creation = False
        self._model_steps = 0
        self._cost_available = True
        self._cost_usd = 0.0
        self._usage_lock = threading.Lock()
        with _request_traces_lock:
            _request_traces[span.trace_id] = self

    def set_outputs(self, outputs: Any) -> None:
        self._span.set_outputs(safe_trace_value(outputs))

    def add_model_usage(self, usage: Mapping[str, Any]) -> None:
        with self._usage_lock:
            self._add_model_usage(usage)

    def _add_model_usage(self, usage: Mapping[str, Any]) -> None:
        self._model_steps += 1
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
        cost_available = usage.get("costAvailable") is True
        if (
            not cost_available
            or not isinstance(cost, (int, float))
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
            "costAvailable": self._model_steps > 0 and self._cost_available,
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


class LangChainUsageCallback(_MlflowLangchainTracer):
    """Enrich autologged model spans and aggregate usage into the AGENT root."""

    def __init__(self, request_trace: AgentRequestTrace | None = None, **kwargs: Any):
        super().__init__(**kwargs)
        self._request_trace = request_trace
        self._model_runs: dict[str, dict[str, Any]] = {}
        self._model_runs_lock = threading.Lock()

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: Any,
        *,
        run_id: Any,
        metadata: dict[str, Any] | None = None,
        invocation_params: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        super().on_chat_model_start(
            serialized,
            messages,
            run_id=run_id,
            metadata=metadata,
            invocation_params=invocation_params,
            **kwargs,
        )
        params = dict(invocation_params or kwargs.get("invocation_params") or {})
        span = self._get_span_by_run_id(run_id)
        with _request_traces_lock:
            request_trace = self._request_trace or _request_traces.get(span.trace_id)
        run = {
            "started_ns": time.perf_counter_ns(),
            "first_token_ns": None,
            "model": params.get("model") or params.get("model_name"),
            "provider": (metadata or {}).get("ls_provider")
            or params.get("provider")
            or _provider_from_type(params.get("_type")),
            "request_trace": request_trace,
        }
        with self._model_runs_lock:
            self._model_runs[str(run_id)] = run

    def on_llm_new_token(self, token: str, *, run_id: Any, **kwargs: Any) -> None:
        with self._model_runs_lock:
            run = self._model_runs.get(str(run_id))
            if run is not None and run["first_token_ns"] is None:
                run["first_token_ns"] = time.perf_counter_ns()
        super().on_llm_new_token(token, run_id=run_id, **kwargs)

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        run_id = kwargs.get("run_id")
        ended_ns = time.perf_counter_ns()
        message = _first_generation_message(response)
        usage = dict(getattr(message, "usage_metadata", None) or {})
        response_metadata = dict(getattr(message, "response_metadata", None) or {})
        llm_output = dict(getattr(response, "llm_output", None) or {})
        legacy_usage = dict(
            llm_output.get("token_usage") or llm_output.get("usage") or {}
        )

        input_tokens = _first_present(
            usage, legacy_usage, "input_tokens", "prompt_tokens"
        )
        output_tokens = _first_present(
            usage, legacy_usage, "output_tokens", "completion_tokens"
        )
        total_tokens = _first_present(usage, legacy_usage, "total_tokens")
        if total_tokens is None:
            total_tokens = _nonnegative_int(input_tokens) + _nonnegative_int(
                output_tokens
            )

        input_details = dict(usage.get("input_token_details") or {})
        cache_read = _first_present(
            input_details,
            usage,
            legacy_usage,
            "cache_read",
            "cache_read_input_tokens",
            "cached_tokens",
        )
        cache_creation = _first_present(
            input_details,
            usage,
            legacy_usage,
            "cache_creation",
            "cache_creation_input_tokens",
        )
        cost = _provider_cost(response_metadata, llm_output, usage)
        normalized: dict[str, Any] = {
            "inputTokens": _nonnegative_int(input_tokens),
            "outputTokens": _nonnegative_int(output_tokens),
            "totalTokens": _nonnegative_int(total_tokens),
            "costAvailable": cost is not None,
        }
        if cache_read is not None:
            normalized["cacheReadInputTokens"] = _nonnegative_int(cache_read)
        if cache_creation is not None:
            normalized["cacheCreationInputTokens"] = _nonnegative_int(cache_creation)
        if cost is not None:
            normalized["costUsd"] = cost
        run = self._pop_model_run(run_id)
        request_trace = run.get("request_trace") or self._request_trace
        if request_trace is not None:
            request_trace.add_model_usage(normalized)

        if run_id is None:
            return
        self._enrich_model_span(
            span=self._get_span_by_run_id(run_id),
            run=run,
            response=response,
            message=message,
            usage=normalized,
            ended_ns=ended_ns,
            error=None,
        )
        super().on_llm_end(response, run_id=run_id)

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        run_id = kwargs.get("run_id")
        safe_error = safe_error_message(error)
        usage = {
            "inputTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0,
            "costAvailable": False,
        }
        run = self._pop_model_run(run_id)
        request_trace = run.get("request_trace") or self._request_trace
        if request_trace is not None:
            request_trace.add_model_usage(usage)
        if run_id is None:
            return
        self._enrich_model_span(
            span=self._get_span_by_run_id(run_id),
            run=run,
            response=None,
            message=None,
            usage=usage,
            ended_ns=time.perf_counter_ns(),
            error=safe_error,
        )
        super().on_llm_error(
            RuntimeError(f"{type(error).__name__}: {safe_error}"), run_id=run_id
        )

    def _pop_model_run(self, run_id: Any) -> dict[str, Any]:
        with self._model_runs_lock:
            return self._model_runs.pop(str(run_id), {})

    def _enrich_model_span(
        self,
        *,
        span: Any,
        run: Mapping[str, Any],
        response: Any,
        message: Any,
        usage: Mapping[str, Any],
        ended_ns: int,
        error: str | None,
    ) -> None:
        response_metadata = dict(getattr(message, "response_metadata", None) or {})
        llm_output = dict(getattr(response, "llm_output", None) or {})
        started_ns = int(run.get("started_ns") or ended_ns)
        first_token_ns = int(run.get("first_token_ns") or ended_ns)
        model = (
            run.get("model")
            or response_metadata.get("model_name")
            or llm_output.get("model_name")
            or span.get_attribute("mlflow.llm.model")
        )
        provider = run.get("provider") or span.get_attribute("mlflow.llm.provider")
        finish_reason = (
            response_metadata.get("finish_reason")
            or _first_generation_info(response).get("finish_reason")
            or ("error" if error else None)
        )
        attributes = {
            "appkit.model": model,
            "appkit.provider": provider,
            "appkit.usage": dict(usage),
            "appkit.ttft_ms": max(0.0, (first_token_ns - started_ns) / 1_000_000),
            "appkit.stream_duration_ms": max(0.0, (ended_ns - started_ns) / 1_000_000),
            "appkit.finish_reason": finish_reason,
            "appkit.error": error,
            "appkit.cost_available": usage.get("costAvailable") is True,
        }
        if usage.get("costAvailable") is True:
            attributes["appkit.cost_usd"] = usage["costUsd"]
            attributes["mlflow.llm.cost"] = usage["costUsd"]
        span.set_attributes(attributes)


def _first_generation_message(response: Any) -> Any:
    generations = getattr(response, "generations", None) or []
    generation = generations[0][0] if generations and generations[0] else None
    return getattr(generation, "message", generation)


def _first_generation_info(response: Any) -> Mapping[str, Any]:
    generations = getattr(response, "generations", None) or []
    generation = generations[0][0] if generations and generations[0] else None
    return dict(getattr(generation, "generation_info", None) or {})


def _provider_from_type(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.removesuffix("-chat").removeprefix("chat-")


def _first_present(*values_and_keys: Any) -> Any:
    mappings = [value for value in values_and_keys if isinstance(value, Mapping)]
    keys = [value for value in values_and_keys if isinstance(value, str)]
    for mapping in mappings:
        for key in keys:
            if mapping.get(key) is not None:
                return mapping[key]
    return None


def _provider_cost(*mappings: Mapping[str, Any]) -> float | None:
    for mapping in mappings:
        for key in ("cost", "cost_usd", "total_cost_usd"):
            value = mapping.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                value = float(value)
                if math.isfinite(value) and value >= 0:
                    return value
    return None


def _nonnegative_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


class TracedOperation:
    def __init__(self, span: Any):
        self._span = span

    def set_outputs(self, outputs: Any) -> None:
        self._span.set_outputs(safe_trace_value(outputs))


@contextmanager
def agent_request_span(name: str, inputs: Any) -> Iterator[AgentRequestTrace]:
    manager = mlflow.start_span(name, span_type=SpanType.AGENT)
    span = manager.__enter__()
    request_trace = AgentRequestTrace(span)
    span.set_inputs(safe_trace_value(inputs))
    try:
        yield request_trace
    except BaseException as error:
        safe_error = safe_error_message(error)
        span.set_outputs({"error": safe_error})
        span.record_exception(f"{type(error).__name__}: {safe_error}")
        request_trace.finalize()
        manager.__exit__(None, None, None)
        raise
    else:
        request_trace.finalize()
        span.set_status("OK")
        manager.__exit__(None, None, None)


@contextmanager
def traced_operation(
    name: str, span_type: str, inputs: Any
) -> Iterator[TracedOperation]:
    manager = mlflow.start_span(name, span_type=span_type)
    span = manager.__enter__()
    operation = TracedOperation(span)
    span.set_inputs(safe_trace_value(inputs))
    try:
        yield operation
    except BaseException as error:
        safe_error = safe_error_message(error)
        span.set_outputs({"error": safe_error})
        span.record_exception(f"{type(error).__name__}: {safe_error}")
        manager.__exit__(None, None, None)
        raise
    else:
        span.set_status("OK")
        manager.__exit__(None, None, None)


@asynccontextmanager
async def traced_async_operation(
    name: str, span_type: str, inputs: Any
) -> AsyncIterator[TracedOperation]:
    with traced_operation(name, span_type, inputs) as operation:
        yield operation
