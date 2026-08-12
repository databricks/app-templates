"""Tracing enforcement and request identity for migrated agents."""

from __future__ import annotations

import ast
from dataclasses import asdict, is_dataclass
import hashlib
import json
import os
import re
from contextvars import ContextVar
from typing import Any, Mapping

import mlflow
from mlflow.entities import SpanStatus
from mlflow.tracing.config import get_config

REQUIRED_TRACING_ENV = (
    "MLFLOW_TRACKING_URI",
    "MLFLOW_EXPERIMENT_ID",
    "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
    "MLFLOW_UC_CATALOG",
    "MLFLOW_UC_SCHEMA",
    "MLFLOW_UC_TABLE_PREFIX",
    "MLFLOW_OTEL_SPANS_TABLE",
)

_selected_autologger: str | None = None
_request_identity: ContextVar[dict[str, str] | None] = ContextVar(
    "migration_request_identity", default=None
)
_MAX_CAPTURE_BYTES = 64 * 1024
_SECRET_KEY = re.compile(
    r"(?:authorization|api[-_]?key|cookie|credential|password|secret|token)",
    re.IGNORECASE,
)
_SECRET_TEXT = re.compile(
    r"(?P<prefix>\b(?:authorization|api[-_]?key|cookie|credential|password|secret|token)"
    r"\b[\"']?\s*(?::|=|\s)\s*)"
    r"(?:(?P<quote>[\"'])(?:bearer\s+)?(?P<quoted_value>.*?)(?P=quote)"
    r"|(?:bearer\s+)?(?P<bare_value>[^\s,;)\]}]+))",
    re.IGNORECASE,
)
_RESERVED_CAPTURE_ATTRIBUTES = {"mlflow.spanInputs", "mlflow.spanOutputs"}
_EXPERIMENT_ID = re.compile(r"^[0-9]+$")
_WAREHOUSE_ID = re.compile(r"^[0-9a-f]{16}$", re.IGNORECASE)
_UC_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,254}$")


def _redact_text(value: str) -> str:
    return _SECRET_TEXT.sub(
        lambda match: (
            f"{match.group('prefix')}"
            f"{match.group('quote') or ''}[REDACTED]{match.group('quote') or ''}"
        ),
        value,
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
            for parser in (json.loads, ast.literal_eval):
                try:
                    return _jsonable(parser(value))
                except (SyntaxError, TypeError, ValueError):
                    pass
            return _redact_text(value)
        if value is None or isinstance(value, (bool, int, float)):
            return value
        return _redact_text(repr(value))
    except BaseException as error:
        return f"<{type(value).__name__}: {type(error).__name__}>"


def safe_trace_value(value: Any, *, max_bytes: int = _MAX_CAPTURE_BYTES) -> Any:
    """Redact secrets and deterministically bound an exported value."""
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
    """Return a bounded error/status message without credential values."""
    safe = safe_trace_value(str(error), max_bytes=2048)
    return safe if isinstance(safe, str) else json.dumps(safe, sort_keys=True)


def _safe_identity_text(value: str) -> str:
    safe = safe_trace_value(str(value), max_bytes=2048)
    return safe if isinstance(safe, str) else json.dumps(safe, sort_keys=True)


def _safe_attribute(key: str, value: Any) -> Any:
    if _SECRET_KEY.search(key):
        return "[REDACTED]"
    return safe_trace_value(value)


def sanitize_span_for_export(span: Any) -> None:
    """Apply one framework-neutral sanitizing boundary before span export."""
    if span.inputs is not None:
        span.set_inputs(safe_trace_value(span.inputs))
    if span.outputs is not None:
        span.set_outputs(safe_trace_value(span.outputs))
    span.set_attributes(
        {
            key: _safe_attribute(key, value)
            for key, value in span.attributes.items()
            if key not in _RESERVED_CAPTURE_ATTRIBUTES
        }
    )
    for event in getattr(span._span, "events", ()):
        event._attributes = {
            str(key): _safe_attribute(str(key), value)
            for key, value in dict(event.attributes).items()
        }
    if description := span.status.description:
        span.set_status(
            SpanStatus(
                status_code=span.status.status_code,
                description=safe_error_message(description),
            )
        )
    if identity := _request_identity.get():
        span.set_attributes(
            {
                "appkit.app.name": identity["appkit.app.name"],
                "appkit.request.id": identity["appkit.request.id"],
                "appkit.session.id": identity["mlflow.trace.session"],
                "appkit.user.id": identity["mlflow.trace.user"],
                "appkit.template": identity["template"],
            }
        )
        if span.parent_id is None:
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
                    tags={"template": identity["template"]},
                )
            except Exception:
                pass


sanitize_span_for_export._appkit_export_boundary = True


def install_sanitizing_export_boundary() -> None:
    """Install the sanitizer last so every integration's fields pass through it."""
    processors = [
        processor
        for processor in get_config().span_processors
        if not getattr(processor, "_appkit_export_boundary", False)
    ]
    mlflow.tracing.configure(span_processors=[*processors, sanitize_span_for_export])


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


def mark_autologger_called(framework: str) -> None:
    """Record the framework whose executable autologger completed successfully."""
    global _selected_autologger
    _selected_autologger = framework


def selected_autologger_was_called(framework: str) -> bool:
    """Report whether the requested integration was enabled in this process."""
    return _selected_autologger == framework


def set_request_trace_identity(
    session_id: str,
    user_id: str,
    request_id: str,
    template_name: str,
) -> None:
    """Attach app, template, request, session, and user identity to the trace."""
    identity = {
        "mlflow.trace.session": _safe_identity_text(session_id),
        "mlflow.trace.user": _safe_identity_text(user_id),
        "appkit.app.name": _safe_identity_text(
            os.getenv("DATABRICKS_APP_NAME", template_name)
        ),
        "appkit.request.id": _safe_identity_text(request_id),
        "template": _safe_identity_text(template_name),
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
            tags={"template": template_name},
        )
    except Exception:
        # Telemetry export must not turn a successful agent response into a failure.
        return
