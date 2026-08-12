"""MLflow tracing primitives shared by the advanced LangGraph request path."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
from contextlib import asynccontextmanager, contextmanager
from dataclasses import asdict, is_dataclass
from typing import Any, AsyncIterator, Iterator, Mapping

import mlflow
from langchain_core.callbacks import BaseCallbackHandler
from mlflow.entities import SpanType

_langchain_autolog = mlflow.langchain.autolog

_MAX_CAPTURE_BYTES = 64 * 1024
_SECRET_KEY = re.compile(
    r"(?:authorization|api[-_]?key|cookie|credential|password|secret|token)", re.IGNORECASE
)
_SECRET_TEXT = re.compile(
    r"(?i)\b(bearer|password|token|secret|api[-_]?key|authorization|credential)"
    r"(\s*(?::|=)?\s+)([^\s,;]+)"
)
_configuration_lock = threading.Lock()
_configured = False


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
        return _SECRET_TEXT.sub(
            lambda match: f"{match.group(1)} [REDACTED]", value
        )
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return repr(value)


def safe_error_message(error: BaseException | str) -> str:
    """Return a bounded exception category without credential values."""
    message = str(error)
    message = _SECRET_TEXT.sub(lambda match: f"{match.group(1)} [REDACTED]", message)
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
            self._cache_read_tokens += _nonnegative_int(usage.get("cacheReadInputTokens"))
        if usage.get("cacheCreationInputTokens") is not None:
            self._has_cache_creation = True
            self._cache_creation_tokens += _nonnegative_int(
                usage.get("cacheCreationInputTokens")
            )

        cost = usage.get("costUsd")
        cost_available = usage.get("costAvailable") is True
        if not cost_available or not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0:
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


class LangChainUsageCallback(BaseCallbackHandler):
    """Aggregate every LangChain model completion into its AGENT root."""

    def __init__(self, request_trace: AgentRequestTrace):
        self._request_trace = request_trace

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        message = _first_generation_message(response)
        usage = dict(getattr(message, "usage_metadata", None) or {})
        response_metadata = dict(getattr(message, "response_metadata", None) or {})
        llm_output = dict(getattr(response, "llm_output", None) or {})
        legacy_usage = dict(llm_output.get("token_usage") or llm_output.get("usage") or {})

        input_tokens = _first_present(usage, legacy_usage, "input_tokens", "prompt_tokens")
        output_tokens = _first_present(
            usage, legacy_usage, "output_tokens", "completion_tokens"
        )
        total_tokens = _first_present(usage, legacy_usage, "total_tokens")
        if total_tokens is None:
            total_tokens = _nonnegative_int(input_tokens) + _nonnegative_int(output_tokens)

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
        self._request_trace.add_model_usage(normalized)

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        self._request_trace.add_model_usage(
            {
                "inputTokens": 0,
                "outputTokens": 0,
                "totalTokens": 0,
                "costAvailable": False,
            }
        )


def _first_generation_message(response: Any) -> Any:
    generations = getattr(response, "generations", None) or []
    generation = generations[0][0] if generations and generations[0] else None
    return getattr(generation, "message", generation)


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
