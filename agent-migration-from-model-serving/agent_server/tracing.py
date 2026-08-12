"""Tracing enforcement and request identity for migrated agents."""

from __future__ import annotations

import os
from contextvars import ContextVar
from typing import Mapping

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

_selected_autologger: str | None = None
_request_identity: ContextVar[dict[str, str] | None] = ContextVar(
    "migration_request_identity", default=None
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
    return {name: source[name] for name in REQUIRED_TRACING_ENV}


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
            tags={"template": template_name},
        )
    except Exception:
        # Telemetry export must not turn a successful agent response into a failure.
        return
