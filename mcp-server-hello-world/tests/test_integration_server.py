import json
import re
from types import SimpleNamespace

import databricks.sdk
import mlflow
import pytest
from fastapi.testclient import TestClient
from mlflow.tracing.provider import provider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from server import utils
from server.app import combined_app

REMOTE_TRACE_ID = "1234567890abcdef1234567890abcdef"
REMOTE_PARENT_ID = "0123456789abcdef"
TRACE_HEADERS = {
    "accept": "application/json, text/event-stream",
    "authorization": "Bearer request-secret",
    "cookie": "session=request-cookie-secret",
    "traceparent": f"00-{REMOTE_TRACE_ID}-{REMOTE_PARENT_ID}-01",
    "tracestate": "vendor=value",
}
TRACING_ENV_NAMES = (
    "MLFLOW_TRACKING_URI",
    "MLFLOW_EXPERIMENT_ID",
    "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
    "MLFLOW_UC_CATALOG",
    "MLFLOW_UC_SCHEMA",
    "MLFLOW_UC_TABLE_PREFIX",
    "MLFLOW_OTEL_SPANS_TABLE",
)


def _set_valid_tracing_environment(monkeypatch, tmp_path) -> None:
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    tracking_uri = f"sqlite:///{tmp_path / 'tracking.db'}"
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "hello-mcp-integration",
        artifact_location=artifact_root.as_uri(),
    )
    values = {
        "MLFLOW_TRACKING_URI": tracking_uri,
        "MLFLOW_EXPERIMENT_ID": experiment_id,
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
        "MLFLOW_UC_CATALOG": "catalog_test",
        "MLFLOW_UC_SCHEMA": "schema_test",
        "MLFLOW_UC_TABLE_PREFIX": "hello_test",
        "MLFLOW_OTEL_SPANS_TABLE": "catalog_test.schema_test.hello_test_otel_spans",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def _capture_spans() -> InMemorySpanExporter:
    provider.get_or_init_tracer("hello-mcp-integration")
    exporter = InMemorySpanExporter()
    provider._isolated_tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return exporter


def _attribute(span, key: str):
    value = span.attributes[key]
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            pass
    return value


def _rpc(client: TestClient, request_id: str, method: str, params: dict) -> object:
    response = client.post(
        "/mcp",
        headers=TRACE_HEADERS,
        json={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
    )
    assert response.status_code == 200
    assert response.headers["x-mlflow-trace-id"] == f"tr-{REMOTE_TRACE_ID}"
    assert re.fullmatch(r"[0-9a-f]{16}", response.headers["x-mlflow-span-id"])
    return response


def test_mcp_jsonrpc_continues_remote_trace_and_traces_concrete_tools(
    monkeypatch, tmp_path
) -> None:
    """Removing context extraction or the concrete tool wrapper must break this trace."""
    _set_valid_tracing_environment(monkeypatch, tmp_path)

    class FailingCurrentUser:
        def me(self):
            raise RuntimeError(
                "authorization: Bearer exception-secret cookie='cookie-secret' " + "x" * 70_000
            )

    class FailingWorkspace:
        current_user = FailingCurrentUser()

    monkeypatch.setattr(
        utils,
        "get_user_authenticated_workspace_client",
        lambda: FailingWorkspace(),
    )
    with TestClient(combined_app) as client:
        exporter = _capture_spans()
        static_response = client.get("/")
        _rpc(client, "api key is 'id-secret'", "tools/list", {})
        response = _rpc(
            client,
            "call-17",
            "tools/call",
            {"name": "health", "arguments": {}},
        )
        failed = _rpc(
            client,
            "error-17",
            "tools/call",
            {"name": "get_current_user", "arguments": {}},
        )

    assert '"isError":false' in response.text
    assert '"error"' in failed.text
    assert "x-mlflow-trace-id" not in static_response.headers

    spans = exporter.get_finished_spans()
    assert len(spans) == 5
    requests = [span for span in spans if span.name == "mcp.tools/call"]
    tools = [span for span in spans if _attribute(span, "mlflow.spanType") == "TOOL"]
    assert len(requests) == 2
    assert len(tools) == 2, [(span.name, dict(span.attributes)) for span in spans]

    health = next(span for span in tools if _attribute(span, "mcp.tool.name") == "health")
    error = next(span for span in tools if _attribute(span, "mcp.tool.name") == "get_current_user")
    health_request = next(
        span for span in requests if _attribute(span, "jsonrpc.request.id") == "call-17"
    )
    assert format(health.context.trace_id, "032x") == REMOTE_TRACE_ID
    assert format(health_request.parent.span_id, "016x") == REMOTE_PARENT_ID
    assert health_request.parent.trace_state.get("vendor") == "value"
    assert response.headers["x-mlflow-span-id"] == format(health_request.context.span_id, "016x")
    assert health.parent.span_id == health_request.context.span_id
    assert _attribute(health, "mcp.server.name") == "custom-mcp-server"
    assert _attribute(health, "jsonrpc.request.id") == "call-17"
    assert _attribute(health, "mlflow.spanInputs") == {}
    assert _attribute(health, "mlflow.spanOutputs")["status"] == "healthy"
    assert _attribute(health, "mcp.tool.latency_ms") >= 0
    assert health.status.status_code.name == "OK"

    assert error.status.status_code.name == "ERROR"
    assert _attribute(error, "mcp.tool.status") == "ERROR"
    assert _attribute(error, "mlflow.spanOutputs")["truncated"] is True
    assert _attribute(error, "mlflow.spanOutputs")["originalBytes"] > 70_000
    assert len(_attribute(error, "mlflow.spanOutputs")["sha256"]) == 64
    exported = json.dumps([dict(span.attributes) for span in spans], sort_keys=True)
    for secret in (
        "request-secret",
        "request-cookie-secret",
        "exception-secret",
        "cookie-secret",
        "id-secret",
    ):
        assert secret not in exported


def test_startup_reports_all_missing_and_invalid_tracing_configuration(monkeypatch) -> None:
    """Dropping aggregate startup validation must admit a partially configured server."""
    for name in TRACING_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", "not-an-id")
    monkeypatch.setenv("MLFLOW_TRACING_SQL_WAREHOUSE_ID", "warehouse")
    monkeypatch.setenv("MLFLOW_UC_CATALOG", "bad.catalog")

    with pytest.raises(RuntimeError) as caught:
        with TestClient(combined_app):
            pass

    message = str(caught.value)
    for name in TRACING_ENV_NAMES:
        assert name in message


def test_databricks_startup_reports_experiment_location_and_warehouse_failures(
    monkeypatch,
) -> None:
    """Skipping either deployment binding check must admit an unusable MCP server."""
    from server import tracing

    values = {
        "MLFLOW_TRACKING_URI": "databricks",
        "MLFLOW_EXPERIMENT_ID": "123",
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
        "MLFLOW_UC_CATALOG": "catalog_test",
        "MLFLOW_UC_SCHEMA": "schema_test",
        "MLFLOW_UC_TABLE_PREFIX": "hello_test",
        "MLFLOW_OTEL_SPANS_TABLE": "catalog_test.schema_test.hello_test_otel_spans",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    experiment = SimpleNamespace(
        lifecycle_stage="active",
        trace_location=SimpleNamespace(
            catalog_name="wrong_catalog",
            schema_name="wrong_schema",
            table_prefix="wrong_prefix",
            full_otel_spans_table_name="wrong_catalog.wrong_schema.wrong_prefix_otel_spans",
        ),
    )
    monkeypatch.setattr(
        mlflow,
        "MlflowClient",
        lambda: SimpleNamespace(get_experiment=lambda _experiment_id: experiment),
    )
    monkeypatch.setattr(mlflow, "set_tracking_uri", lambda _uri: None)
    monkeypatch.setattr(mlflow, "set_experiment", lambda **_kwargs: None)

    class Warehouses:
        def get(self, _warehouse_id):
            raise RuntimeError("warehouse not found")

    monkeypatch.setattr(
        databricks.sdk,
        "WorkspaceClient",
        lambda: SimpleNamespace(warehouses=Warehouses()),
    )

    with pytest.raises(RuntimeError) as caught:
        tracing.configure_mlflow_tracing()

    assert "wrong UC trace location" in str(caught.value)
    assert "warehouse not found" in str(caught.value)


def test_runtime_export_failure_is_logged_safely_without_failing_tool(
    monkeypatch, tmp_path, caplog
) -> None:
    """Leaking an exporter exception or failing the tool response must break this test."""
    _set_valid_tracing_environment(monkeypatch, tmp_path)
    with TestClient(combined_app) as client:

        def fail_export(**_kwargs):
            raise RuntimeError("token export-secret")

        monkeypatch.setattr(mlflow, "start_span", fail_export)
        response = client.post(
            "/mcp",
            headers={"accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": "export-17",
                "method": "tools/call",
                "params": {"name": "health", "arguments": {}},
            },
        )

    assert response.status_code == 200
    assert '"isError":false' in response.text
    assert "MLflow span export failed" in caplog.text
    assert "[REDACTED]" in caplog.text
    assert "export-secret" not in caplog.text
