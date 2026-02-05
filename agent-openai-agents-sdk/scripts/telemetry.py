"""
Direct telemetry sender for app templates.

Sends telemetry to MLflow telemetry endpoint, bypassing the normal disable checks
that prevent telemetry when tracking URI is set to Databricks.
"""

import platform
import sys
import time
import uuid
from typing import Any

import requests
from mlflow.telemetry.installation_id import get_or_create_installation_id
from mlflow.version import VERSION

# Session ID persists for the lifetime of this process (one per app run)
_SESSION_ID: str | None = None


def _get_session_id() -> str:
    global _SESSION_ID
    if _SESSION_ID is None:
        _SESSION_ID = uuid.uuid4().hex
    return _SESSION_ID


def send_telemetry(
    event_name: str,
    params: dict[str, Any] | None = None,
) -> None:
    """
    Send telemetry directly to MLflow telemetry endpoint.

    Args:
        event_name: Name of the telemetry event.
        params: Optional parameters to include with the event.
    """
    try:
        ingestion_url = "https://api.mlflow-telemetry.io/log"

        # Reuse MLflow's persistent installation ID
        installation_id = get_or_create_installation_id() or uuid.uuid4().hex
        # Session ID is unique per process run
        session_id = _get_session_id()

        record = {
            "data": {
                "session_id": session_id,
                "installation_id": installation_id,
                "source_sdk": "mlflow",
                "mlflow_version": VERSION,
                "schema_version": 2,
                "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
                "operating_system": platform.platform(),
                "timestamp_ns": time.time_ns(),
                "event_name": event_name,
                "status": "success",
                "duration_ms": 0,
                "tracking_uri_scheme": "databricks",
                "params": params,
            },
            "partition-key": uuid.uuid4().hex,
        }

        requests.post(
            ingestion_url,
            json={"records": [record]},
            headers={"Content-Type": "application/json"},
            timeout=1,
        )
    except Exception:
        pass  # Fail silently - telemetry should never break the app
