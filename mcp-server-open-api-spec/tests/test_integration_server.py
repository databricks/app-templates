import asyncio
import hashlib
import io
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

REMOTE_TRACE_ID = "1234567890abcdef1234567890abcdef"
REMOTE_PARENT_ID = "0123456789abcdef"
TRACE_HEADERS = {
    "accept": "application/json, text/event-stream",
    "authorization": "Bearer request-secret",
    "cookie": "session=request-cookie-secret",
    "traceparent": f"00-{REMOTE_TRACE_ID}-{REMOTE_PARENT_ID}-01",
    "tracestate": "vendor=value",
}
OPENAPI_SPEC = {
    "openapi": "3.0.0",
    "paths": {"/widgets": {"get": {"operationId": "listWidgets", "summary": "List widgets"}}},
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
        "openapi-mcp-integration",
        artifact_location=artifact_root.as_uri(),
    )
    values = {
        "MLFLOW_TRACKING_URI": tracking_uri,
        "MLFLOW_EXPERIMENT_ID": experiment_id,
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
        "MLFLOW_UC_CATALOG": "catalog_test",
        "MLFLOW_UC_SCHEMA": "schema_test",
        "MLFLOW_UC_TABLE_PREFIX": "openapi_test",
        "MLFLOW_OTEL_SPANS_TABLE": "catalog_test.schema_test.openapi_test_otel_spans",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def _capture_spans() -> InMemorySpanExporter:
    provider.get_or_init_tracer("openapi-mcp-integration")
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


class _Files:
    def download(self, _path: str):
        return type(
            "Download",
            (),
            {"contents": io.BytesIO(json.dumps(OPENAPI_SPEC).encode())},
        )()


class _Workspace:
    files = _Files()


def _get_combined_app(monkeypatch):
    monkeypatch.setattr(databricks.sdk, "WorkspaceClient", lambda *args, **kwargs: _Workspace())
    monkeypatch.setenv("UC_CONNECTION_NAME", "test-connection")
    monkeypatch.setenv("SPEC_VOLUME_PATH", "/Volumes/catalog/schema/specs")
    monkeypatch.setenv("SPEC_FILE_NAME", "spec.json")
    from custom_server.app import combined_app

    return combined_app


def _rpc(
    client: TestClient,
    headers: dict[str, str],
    request_id: str | None,
    method: str,
    params: dict,
):
    payload = {"jsonrpc": "2.0", "method": method, "params": params}
    if request_id is not None:
        payload["id"] = request_id
    return client.post("/mcp", headers=headers, json=payload)


def test_mcp_jsonrpc_continues_remote_trace_and_traces_concrete_tools(
    monkeypatch, tmp_path
) -> None:
    """Removing context extraction or the concrete tool wrapper must break this trace."""
    _set_valid_tracing_environment(monkeypatch, tmp_path)
    combined_app = _get_combined_app(monkeypatch)
    import custom_server.tools as tools_module

    monkeypatch.setattr(
        tools_module,
        "invoke_endpoint_handler",
        lambda _args: SimpleNamespace(
            ok=False,
            status_code=503,
            headers={"retry-after": "1"},
            text="temporarily unavailable",
            response_json={"status": "unavailable"},
        ),
    )

    headers = dict(TRACE_HEADERS)
    with TestClient(combined_app) as client:
        exporter = _capture_spans()
        static_response = client.get("/")
        health_response = client.get("/health")
        listed = _rpc(client, headers, "api key is 'id-secret'", "tools/list", {})
        called = _rpc(
            client,
            headers,
            "call-17",
            "tools/call",
            {"name": "list_api_endpoints", "arguments": {"search_query": "widgets"}},
        )
        failed = _rpc(
            client,
            headers,
            "error-17",
            "tools/call",
            {
                "name": "get_api_endpoint_schema",
                "arguments": {
                    "endpoint_path": "api key is 'schema-secret'",
                    "http_method": "GET",
                },
            },
        )
        ok_false = _rpc(
            client,
            headers,
            "ok-false-17",
            "tools/call",
            {
                "name": "invoke_api_endpoint",
                "arguments": {
                    "endpoint_path": "/widgets",
                    "http_method": "GET",
                    "headers": {"authorization": "Bearer tool-secret"},
                },
            },
        )

    for response in (listed, called):
        assert response.status_code == 200
        assert response.headers["x-mlflow-trace-id"] == f"tr-{REMOTE_TRACE_ID}"
        assert re.fullmatch(r"[0-9a-f]{16}", response.headers["x-mlflow-span-id"])
    assert '"isError":false' in called.text
    assert '"isError":true' in failed.text
    assert '"ok":false' in ok_false.text
    assert "x-mlflow-trace-id" not in static_response.headers
    assert "x-mlflow-trace-id" not in health_response.headers

    spans = exporter.get_finished_spans()
    assert len(spans) == 7
    request_spans = [span for span in spans if _attribute(span, "mlflow.spanType") == "AGENT"]
    assert {span.name for span in request_spans} == {"mcp.request"}
    requests = [
        span for span in request_spans if _attribute(span, "jsonrpc.method") == "tools/call"
    ]
    tools = [span for span in spans if _attribute(span, "mlflow.spanType") == "TOOL"]
    assert len(requests) == 3
    assert len(tools) == 3, [(span.name, dict(span.attributes)) for span in spans]

    listed_tool = next(
        span for span in tools if _attribute(span, "mcp.tool.name") == "list_api_endpoints"
    )
    error = next(
        span for span in tools if _attribute(span, "mcp.tool.name") == "get_api_endpoint_schema"
    )
    ok_false_error = next(
        span for span in tools if _attribute(span, "mcp.tool.name") == "invoke_api_endpoint"
    )
    tool_request = next(
        span for span in requests if _attribute(span, "jsonrpc.request.id") == "call-17"
    )
    error_request = next(
        span for span in requests if _attribute(span, "jsonrpc.request.id") == "error-17"
    )
    ok_false_request = next(
        span for span in requests if _attribute(span, "jsonrpc.request.id") == "ok-false-17"
    )
    assert format(listed_tool.context.trace_id, "032x") == REMOTE_TRACE_ID
    assert format(tool_request.parent.span_id, "016x") == REMOTE_PARENT_ID
    assert tool_request.parent.trace_state.get("vendor") == "value"
    assert called.headers["x-mlflow-span-id"] == format(tool_request.context.span_id, "016x")
    assert listed_tool.parent.span_id == tool_request.context.span_id
    assert _attribute(tool_request, "mlflow.spanInputs") == {
        "jsonrpc": "2.0",
        "id": "call-17",
        "method": "tools/call",
        "params": {
            "name": "list_api_endpoints",
            "arguments": {"search_query": "widgets"},
        },
    }
    assert _attribute(tool_request, "mlflow.spanOutputs")["result"]["isError"] is False
    assert _attribute(tool_request, "mcp.request.status") == "OK"
    assert _attribute(tool_request, "mcp.request.latency_ms") >= 0
    assert tool_request.status.status_code.name == "OK"
    assert _attribute(listed_tool, "mcp.server.name") == "custom-open-api-spec-server"
    assert _attribute(listed_tool, "jsonrpc.request.id") == "call-17"
    assert _attribute(listed_tool, "mlflow.spanInputs") == {"search_query": "widgets"}
    assert _attribute(listed_tool, "mlflow.spanOutputs")["total"] == 1
    assert _attribute(listed_tool, "mcp.tool.latency_ms") >= 0
    assert listed_tool.status.status_code.name == "OK"

    assert error.status.status_code.name == "ERROR"
    assert error_request.status.status_code.name == "ERROR"
    assert _attribute(error_request, "mcp.request.status") == "ERROR"
    assert _attribute(error_request, "mcp.request.error")
    assert _attribute(error, "mcp.tool.status") == "ERROR"
    assert (
        _attribute(error, "mcp.tool.error")
        == "Endpoint api key is '[REDACTED]' not found in API specification"
    )
    assert ok_false_error.status.status_code.name == "ERROR"
    assert _attribute(ok_false_error, "mcp.tool.status") == "ERROR"
    assert ok_false_request.status.status_code.name == "ERROR"
    assert _attribute(ok_false_request, "mcp.request.status") == "ERROR"
    assert (
        _attribute(ok_false_request, "mlflow.spanOutputs")["result"]["structuredContent"]["ok"]
        is False
    )
    list_request = next(
        span for span in request_spans if _attribute(span, "jsonrpc.method") == "tools/list"
    )
    assert _attribute(list_request, "mlflow.spanOutputs")["id"] == "api key is '[REDACTED]'"
    assert _attribute(list_request, "mcp.request.status") == "OK"
    exported = json.dumps([dict(span.attributes) for span in spans], sort_keys=True)
    for secret in (
        "request-secret",
        "request-cookie-secret",
        "schema-secret",
        "id-secret",
        "tool-secret",
    ):
        assert secret not in exported


def test_router_error_captures_bounded_request_lifecycle_without_method_leak(
    monkeypatch, tmp_path
) -> None:
    """A malformed method must produce safe, complete request-span telemetry."""
    _set_valid_tracing_environment(monkeypatch, tmp_path)
    combined_app = _get_combined_app(monkeypatch)
    method = "api key is 'method-secret'"
    with TestClient(combined_app) as client:
        exporter = _capture_spans()
        response = _rpc(
            client,
            dict(TRACE_HEADERS),
            "router-error-17",
            method,
            {"note": "cookie is 'body-secret'"},
        )

    assert "Invalid request parameters" in response.text
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    request = spans[0]
    assert request.name == "mcp.request"
    assert _attribute(request, "mlflow.spanInputs") == {
        "jsonrpc": "2.0",
        "id": "router-error-17",
        "method": "api key is '[REDACTED]'",
        "params": {"note": "cookie is '[REDACTED]'"},
    }
    output = _attribute(request, "mlflow.spanOutputs")
    assert output["error"]["code"] == -32602
    assert output["error"]["message"] == "Invalid request parameters"
    assert _attribute(request, "mcp.request.status") == "ERROR"
    assert _attribute(request, "mcp.request.error") == "Invalid request parameters"
    assert _attribute(request, "mcp.request.latency_ms") >= 0
    assert request.status.status_code.name == "ERROR"
    exported = json.dumps([dict(span.attributes) for span in spans], sort_keys=True)
    assert "method-secret" not in exported
    assert "body-secret" not in exported


def test_streamed_response_capture_stays_bounded_until_last_body(monkeypatch, tmp_path) -> None:
    """A many-chunk SSE response must not create an unbounded in-flight buffer."""
    _get_combined_app(monkeypatch)
    from custom_server import tracing

    _set_valid_tracing_environment(monkeypatch, tmp_path)
    tracing.configure_mlflow_tracing()
    exporter = _capture_spans()
    observed_buffer_sizes: list[int] = []
    real_bytearray = bytearray

    class TrackingBytearray(real_bytearray):
        def extend(self, value) -> None:
            super().extend(value)
            observed_buffer_sizes.append(len(self))

    monkeypatch.setattr(tracing, "bytearray", TrackingBytearray, raising=False)
    prefix = (
        b'event: message\ndata: {"jsonrpc":"2.0","id":"stream-17","error":'
        b'{"message":"authorization: Bearer stream-secret"},"padding":"'
    )
    padding = [f"{index:04d}".encode() + b"x" * (8 * 1024 - 4) for index in range(128)]
    response_chunks = [prefix, *padding, b'"}\n\n']
    complete_response = b"".join(response_chunks)
    finished_during_send: list[int] = []

    async def streaming_app(_scope, receive, send) -> None:
        await receive()
        await send(
            {
                "type": "http.response.start",
                "status": 503,
                "headers": [(b"content-type", b"text/event-stream")],
            }
        )
        for index, chunk in enumerate(response_chunks):
            await send(
                {
                    "type": "http.response.body",
                    "body": chunk,
                    "more_body": index < len(response_chunks) - 1,
                }
            )
            finished_during_send.append(len(exporter.get_finished_spans()))

    middleware = tracing.TraceContextMiddleware(streaming_app, server_name="bounded-test")
    request_body = json.dumps(
        {"jsonrpc": "2.0", "id": "stream-17", "method": "tools/list", "params": {}}
    ).encode()
    request_messages = [{"type": "http.request", "body": request_body, "more_body": False}]
    sent_messages: list[dict] = []

    async def receive():
        if request_messages:
            return request_messages.pop(0)
        return {"type": "http.disconnect"}

    async def send(message) -> None:
        sent_messages.append(message)

    asyncio.run(
        middleware(
            {
                "type": "http",
                "method": "POST",
                "path": "/mcp",
                "headers": [
                    (key.encode("latin-1"), value.encode("latin-1"))
                    for key, value in TRACE_HEADERS.items()
                ],
            },
            receive,
            send,
        )
    )

    assert max(observed_buffer_sizes) <= 4 * 64 * 1024
    assert finished_during_send and set(finished_during_send) == {0}
    span = exporter.get_finished_spans()[0]
    output = _attribute(span, "mlflow.spanOutputs")
    assert output["truncated"] is True
    assert output["originalBytes"] == len(complete_response)
    assert output["sha256"] == hashlib.sha256(complete_response).hexdigest()
    assert "event: message" in output["preview"]
    assert "[REDACTED]" in output["preview"]
    assert "stream-secret" not in json.dumps(dict(span.attributes), sort_keys=True)
    assert _attribute(span, "mcp.request.status") == "ERROR"
    assert _attribute(span, "mcp.request.error") == "HTTP 503"
    assert _attribute(span, "http.response.status_code") == 503
    assert span.status.status_code.name == "ERROR"
    response_start = next(
        message for message in sent_messages if message["type"] == "http.response.start"
    )
    response_headers = dict(response_start["headers"])
    assert response_headers[b"x-mlflow-trace-id"] == f"tr-{REMOTE_TRACE_ID}".encode()
    assert re.fullmatch(rb"[0-9a-f]{16}", response_headers[b"x-mlflow-span-id"])
    assert format(span.parent.span_id, "016x") == REMOTE_PARENT_ID


def test_startup_reports_all_missing_and_invalid_tracing_configuration(monkeypatch) -> None:
    """Dropping aggregate startup validation must admit a partially configured server."""
    combined_app = _get_combined_app(monkeypatch)
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
    _get_combined_app(monkeypatch)
    from custom_server import tracing

    values = {
        "MLFLOW_TRACKING_URI": "databricks",
        "MLFLOW_EXPERIMENT_ID": "123",
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
        "MLFLOW_UC_CATALOG": "catalog_test",
        "MLFLOW_UC_SCHEMA": "schema_test",
        "MLFLOW_UC_TABLE_PREFIX": "openapi_test",
        "MLFLOW_OTEL_SPANS_TABLE": "catalog_test.schema_test.openapi_test_otel_spans",
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
    combined_app = _get_combined_app(monkeypatch)
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
                "params": {"name": "list_api_endpoints", "arguments": {}},
            },
        )
        router_response = client.post(
            "/mcp",
            headers={"accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": "export-router-17",
                "method": "api key is 'method-secret'",
                "params": {},
            },
        )

    assert response.status_code == 200
    assert '"isError":false' in response.text
    assert "Invalid request parameters" in router_response.text
    tracing_logs = "\n".join(
        record.getMessage() for record in caplog.records if record.name == "custom_server.tracing"
    )
    assert "MLflow span export failed" in tracing_logs
    assert "[REDACTED]" in tracing_logs
    assert "export-secret" not in tracing_logs
    assert "method-secret" not in tracing_logs
