"""Export the app's log records through OpenTelemetry when Apps asks for it."""

import logging
import os

from opentelemetry.instrumentation import auto_instrumentation

from agent.settings import settings

APP_LOGGERS = ("agent", "runtime")


def resource_attributes(platform: str, version: str, environment: str) -> str:
    """The platform's resource attributes, then the app's version and environment."""
    own = f"service.version={version},deployment.environment.name={environment}"
    return f"{platform},{own}" if platform else own


def configure_telemetry() -> bool:
    """Enable OpenTelemetry export if endpoint is set. Return True if enabled."""
    for name in APP_LOGGERS:
        logging.getLogger(name).setLevel(logging.INFO)
    if not os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return False
    os.environ["OTEL_RESOURCE_ATTRIBUTES"] = resource_attributes(
        os.getenv("OTEL_RESOURCE_ATTRIBUTES", ""),
        settings().version,
        settings().environment,
    )
    os.environ.setdefault("OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED", "true")
    auto_instrumentation.initialize(swallow_exceptions=False)
    return True
