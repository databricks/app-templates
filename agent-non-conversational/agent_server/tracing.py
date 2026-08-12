"""Trace policy for the non-conversational document agent."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, is_dataclass
import hashlib
import json
import math
import os
import re
from time import perf_counter_ns
from typing import Any, Iterator, Mapping

import mlflow

REQUIRED_TRACING_ENV = (
    "MLFLOW_TRACKING_URI",
    "MLFLOW_EXPERIMENT_ID",
    "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
    "MLFLOW_UC_CATALOG",
    "MLFLOW_UC_SCHEMA",
    "MLFLOW_UC_TABLE_PREFIX",
    "MLFLOW_OTEL_SPANS_TABLE",
)

_MAX_CAPTURE_BYTES = 64 * 1024
_SECRET_KEY = re.compile(
    r"(?:authorization|api[-_]?key|cookie|credential|password|secret|token)",
    re.IGNORECASE,
)
_SECRET_TEXT = re.compile(
    r"(?P<prefix>\b(?:authorization|api[-_]?key|cookie|credential|password|secret|token)"
    r"\b\s*(?::|=|\s)\s*(?:bearer\s+)?)"
    r"(?P<value>[^\s,;)\]}]+)",
    re.IGNORECASE,
)
_EXPERIMENT_ID = re.compile(r"^[0-9]+$")
_WAREHOUSE_ID = re.compile(r"^[0-9a-f]{16}$", re.IGNORECASE)
_UC_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,254}$")
_request_identity: ContextVar[dict[str, str] | None] = ContextVar(
    "batch_request_identity", default=None
)


def validate_tracing_environment(
    environ: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Return mandatory tracing configuration or report every missing value."""
    source = os.environ if environ is None else environ
    missing = [name for name in REQUIRED_TRACING_ENV if not source.get(name, "").strip()]
    if missing:
        raise RuntimeError(
            "Missing required tracing configuration: " + ", ".join(missing)
        )
    config = {name: source[name] for name in REQUIRED_TRACING_ENV}
    invalid: list[str] = []
    if not _EXPERIMENT_ID.fullmatch(config["MLFLOW_EXPERIMENT_ID"]):
        invalid.append("MLFLOW_EXPERIMENT_ID must be numeric")
    if not _WAREHOUSE_ID.fullmatch(config["MLFLOW_TRACING_SQL_WAREHOUSE_ID"]):
        invalid.append("MLFLOW_TRACING_SQL_WAREHOUSE_ID must be a 16-hex ID")
    for name in ("MLFLOW_UC_CATALOG", "MLFLOW_UC_SCHEMA", "MLFLOW_UC_TABLE_PREFIX"):
        if not _UC_IDENTIFIER.fullmatch(config[name]):
            invalid.append(f"{name} must be a simple UC identifier")
    expected_table = ".".join(
        (
            config["MLFLOW_UC_CATALOG"],
            config["MLFLOW_UC_SCHEMA"],
            f"{config['MLFLOW_UC_TABLE_PREFIX']}_otel_spans",
        )
    )
    if config["MLFLOW_OTEL_SPANS_TABLE"] != expected_table:
        invalid.append(
            "MLFLOW_OTEL_SPANS_TABLE must equal "
            "<MLFLOW_UC_CATALOG>.<MLFLOW_UC_SCHEMA>."
            "<MLFLOW_UC_TABLE_PREFIX>_otel_spans"
        )
    if invalid:
        raise RuntimeError("Invalid tracing configuration: " + "; ".join(invalid))
    return config


def configure_mlflow_tracing() -> None:
    """Validate UC export configuration before constructing external clients."""
    config = validate_tracing_environment()
    mlflow.set_tracking_uri(config["MLFLOW_TRACKING_URI"])
    if config["MLFLOW_TRACKING_URI"].startswith("databricks"):
        verify_deployment_trace_resources(config)
    mlflow.set_experiment(experiment_id=config["MLFLOW_EXPERIMENT_ID"])


def verify_deployment_trace_resources(
    config: dict[str, str],
    *,
    mlflow_client=None,
    workspace_client=None,
) -> None:
    """Prove the configured experiment location and warehouse are available."""
    issues: list[str] = []
    client = mlflow_client or mlflow.MlflowClient()
    experiment = None
    try:
        experiment = client.get_experiment(config["MLFLOW_EXPERIMENT_ID"])
    except Exception as error:
        issues.append(
            f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} is unavailable: {error}"
        )
    if experiment is None:
        issues.append(f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} does not exist")
    else:
        raw_lifecycle = getattr(experiment, "lifecycle_stage", None)
        lifecycle = str(getattr(raw_lifecycle, "value", raw_lifecycle) or "")
        if lifecycle.lower() != "active":
            issues.append(
                f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} is unavailable "
                f"(lifecycle stage: {lifecycle or 'missing'})"
            )
        location = experiment.trace_location
        observed = (
            getattr(location, "catalog_name", None),
            getattr(location, "schema_name", None),
            getattr(location, "table_prefix", None),
            getattr(location, "full_otel_spans_table_name", None),
        )
        expected = (
            config["MLFLOW_UC_CATALOG"],
            config["MLFLOW_UC_SCHEMA"],
            config["MLFLOW_UC_TABLE_PREFIX"],
            config["MLFLOW_OTEL_SPANS_TABLE"],
        )
        if observed != expected:
            issues.append(
                f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} has wrong UC trace "
                f"location {observed!r}; expected {expected!r}"
            )

    if workspace_client is None:
        from databricks.sdk import WorkspaceClient

        workspace_client = WorkspaceClient()
    warehouse_id = config["MLFLOW_TRACING_SQL_WAREHOUSE_ID"]
    try:
        warehouse = workspace_client.warehouses.get(warehouse_id)
        raw_state = getattr(warehouse, "state", None)
        state = str(getattr(raw_state, "value", raw_state) or "")
        if state.upper() in {"DELETED", "DELETING"}:
            issues.append(f"SQL warehouse {warehouse_id!r} is unavailable (state: {state})")
    except Exception as error:
        issues.append(f"SQL warehouse {warehouse_id!r} is unavailable: {error}")

    if issues:
        raise RuntimeError("Deployment tracing preflight failed: " + "; ".join(issues))


def _redact_text(value: str) -> str:
    return _SECRET_TEXT.sub(
        lambda match: f"{match.group('prefix')}[REDACTED]", value
    )


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
            return _redact_text(value)
        if value is None or isinstance(value, (bool, int, float)):
            return value
        return _redact_text(repr(value))
    except BaseException as error:
        return f"<{type(value).__name__}: {type(error).__name__}>"


def safe_trace_value(value: Any, *, max_bytes: int = _MAX_CAPTURE_BYTES) -> Any:
    """Redact secrets and deterministically bound a captured value."""
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


def safe_error_message(error: BaseException | str) -> str:
    """Return a bounded error message without credential values."""
    message = _redact_text(str(error))
    encoded = message.encode("utf-8")
    if len(encoded) <= 2048:
        return message
    return json.dumps(safe_trace_value(message, max_bytes=2048), sort_keys=True)


def set_request_trace_identity(
    session_id: str,
    user_id: str,
    request_id: str,
    template_name: str,
) -> None:
    """Attach app, template, request, session, and user identity to the trace."""
    identity = {
        "mlflow.trace.session": session_id,
        "mlflow.trace.user": user_id,
        "appkit.app.name": os.getenv("DATABRICKS_APP_NAME", template_name),
        "appkit.request.id": request_id,
        "template": template_name,
    }
    _request_identity.set(identity)
    try:
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
            tags={"template": template_name, "agent": "document-analysis"},
        )
    except Exception:
        # Telemetry export must not turn a successful response into a failure.
        return


class NullSpan:
    """No-op span used when runtime telemetry export is unavailable."""

    def set_inputs(self, _value: Any) -> None:
        pass

    def set_outputs(self, _value: Any) -> None:
        pass

    def set_attribute(self, _key: str, _value: Any) -> None:
        pass

    def set_attributes(self, _values: Mapping[str, Any]) -> None:
        pass

    def set_status(self, _status: str) -> None:
        pass

    def record_exception(self, _error: BaseException) -> None:
        pass


def _safe_span_call(span: Any, method: str, *args: Any) -> None:
    try:
        getattr(span, method)(*args)
    except Exception:
        pass


@contextmanager
def traced_span(name: str, span_type: str, inputs: Any) -> Iterator[Any]:
    """Create a span whose telemetry failures never alter agent execution."""
    started_ns = perf_counter_ns()
    try:
        manager = mlflow.start_span(name=name, span_type=span_type)
        span = manager.__enter__()
        _safe_span_call(span, "set_inputs", safe_trace_value(inputs))
    except Exception:
        yield NullSpan()
        return

    try:
        yield span
    except BaseException as error:
        safe_error = safe_error_message(error)
        set_span_result(
            span,
            outputs={"error": safe_error},
            attributes={
                "appkit.error": safe_error,
                "appkit.duration_ms": elapsed_ms(started_ns),
            },
            status="ERROR",
            error=error,
        )
        try:
            manager.__exit__(None, None, None)
        except Exception:
            pass
        raise
    else:
        try:
            manager.__exit__(None, None, None)
        except Exception:
            pass


def set_span_result(
    span: Any,
    *,
    outputs: Any,
    attributes: Mapping[str, Any],
    status: str,
    error: BaseException | None = None,
) -> None:
    """Finalize observable span fields without affecting the response path."""
    _safe_span_call(span, "set_outputs", safe_trace_value(outputs))
    _safe_span_call(span, "set_attributes", dict(attributes))
    if error is not None:
        message = safe_error_message(error)
        _safe_span_call(
            span,
            "record_exception",
            RuntimeError(f"{type(error).__name__}: {message}"),
        )
    _safe_span_call(span, "set_status", status)


def elapsed_ms(started_ns: int) -> float:
    return max(0.0, (perf_counter_ns() - started_ns) / 1_000_000)


def document_identity(document_text: str) -> dict[str, Any]:
    encoded = document_text.encode("utf-8")
    return {
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "bytes": len(encoded),
    }


def _nonnegative_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def completion_usage(response: Any) -> dict[str, Any]:
    """Normalize exact provider token usage and optional cost."""
    raw = getattr(response, "usage", None)
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
    cost = None
    for source in (usage, getattr(response, "model_extra", None)):
        if not isinstance(source, Mapping):
            continue
        for key in ("cost_usd", "total_cost_usd", "cost"):
            candidate = source.get(key)
            if (
                isinstance(candidate, (int, float))
                and not isinstance(candidate, bool)
                and math.isfinite(candidate)
                and candidate >= 0
            ):
                cost = float(candidate)
                break
        if cost is not None:
            break
    normalized: dict[str, Any] = {
        "inputTokens": _nonnegative_int(input_tokens),
        "outputTokens": _nonnegative_int(output_tokens),
        "totalTokens": _nonnegative_int(total_tokens),
        "costAvailable": cost is not None,
    }
    if cost is not None:
        normalized["costUsd"] = cost
    return normalized


class UsageAccumulator:
    """Aggregate model usage without fabricating unavailable cost."""

    def __init__(self) -> None:
        self.input_tokens = 0
        self.output_tokens = 0
        self.total_tokens = 0
        self.model_calls = 0
        self.cost_available = True
        self.cost_usd = 0.0

    def add(self, usage: Mapping[str, Any]) -> None:
        self.model_calls += 1
        self.input_tokens += _nonnegative_int(usage.get("inputTokens"))
        self.output_tokens += _nonnegative_int(usage.get("outputTokens"))
        self.total_tokens += _nonnegative_int(usage.get("totalTokens"))
        if usage.get("costAvailable") is not True:
            self.cost_available = False
        else:
            self.cost_usd += float(usage["costUsd"])

    def snapshot(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "totalTokens": self.total_tokens,
            "costAvailable": self.model_calls > 0 and self.cost_available,
        }
        if result["costAvailable"]:
            result["costUsd"] = round(self.cost_usd, 12)
        return result
