import logging

import pytest
from databricks_agentkit import DurableAgentServer
from fastapi.testclient import TestClient

from runtime import telemetry

PLATFORM = "workspace.id=1,app.name=agent-bricks-agent"


@pytest.fixture
def initialized(monkeypatch) -> list[dict]:
    calls = []
    monkeypatch.setattr(
        telemetry.auto_instrumentation,
        "initialize",
        lambda **kwargs: calls.append(kwargs),
    )
    return calls


def test_the_app_attributes_follow_the_platforms():
    assert telemetry.resource_attributes(PLATFORM, "abc123", "demo") == (
        f"{PLATFORM},service.version=abc123,deployment.environment.name=demo"
    )
    assert telemetry.resource_attributes("", "abc123", "demo") == (
        "service.version=abc123,deployment.environment.name=demo"
    )


def test_without_an_export_endpoint_nothing_is_exported(monkeypatch, initialized):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    assert telemetry.configure_telemetry() is False
    assert initialized == []


def test_with_an_export_endpoint_records_carry_the_version(monkeypatch, initialized):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4317")
    monkeypatch.setenv("OTEL_RESOURCE_ATTRIBUTES", PLATFORM)

    assert telemetry.configure_telemetry() is True
    assert initialized == [{"swallow_exceptions": False}]
    assert telemetry.os.environ["OTEL_RESOURCE_ATTRIBUTES"] == (
        f"{PLATFORM},service.version=test-version,deployment.environment.name=test"
    )
    assert (
        telemetry.os.environ["OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED"]
        == "true"
    )


async def answer_nothing(value, context) -> dict:
    return {"output": [], "status": "completed"}


def test_the_server_starts_on_apps_without_a_telemetry_warning(
    monkeypatch, caplog, runtime_store
):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4314")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")
    app = DurableAgentServer(runtime_store=runtime_store)
    app.invoke(answer_nothing)

    with caplog.at_level(logging.WARNING, logger="fastapi"), TestClient(app):
        pass

    assert not any(
        "automatic telemetry" in record.getMessage() for record in caplog.records
    )
