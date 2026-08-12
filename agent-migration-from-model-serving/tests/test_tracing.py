import asyncio
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

import mlflow.langchain
import mlflow.openai
import pytest
from mlflow.entities import SpanType
from mlflow.entities import Experiment, UnityCatalog
from mlflow.genai.agent_server import server
from mlflow.tracing.config import reset_config
from mlflow.types.responses import ResponsesAgentRequest
from scripts import preflight


REQUIRED_TRACING_ENV = {
    "MLFLOW_TRACKING_URI": "file:///tmp/appkit-migration-test-tracking",
    "MLFLOW_EXPERIMENT_ID": "1",
    "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
    "MLFLOW_UC_CATALOG": "catalog_test",
    "MLFLOW_UC_SCHEMA": "schema_test",
    "MLFLOW_UC_TABLE_PREFIX": "migration_test",
    "MLFLOW_OTEL_SPANS_TABLE": "catalog_test.schema_test.migration_test_otel_spans",
}
PROJECT_ROOT = Path(__file__).parents[1]


@pytest.mark.parametrize("framework", ["langgraph", "openai"])
def test_agent_import_enables_only_the_selected_autologger(
    monkeypatch: pytest.MonkeyPatch, framework: str
) -> None:
    for name, value in REQUIRED_TRACING_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("AGENT_FRAMEWORK", framework)

    calls: list[str] = []
    monkeypatch.setattr(
        mlflow.langchain,
        "autolog",
        lambda **kwargs: calls.append(f"langgraph:{kwargs['log_traces']}"),
    )
    monkeypatch.setattr(
        mlflow.openai,
        "autolog",
        lambda **kwargs: calls.append(f"openai:{kwargs['log_traces']}"),
    )
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    monkeypatch.setattr(server, "_invoke_function", None)
    monkeypatch.setattr(server, "_stream_function", None)

    importlib.import_module("agent_server.agent")

    assert calls == [f"{framework}:True"]


def test_agent_import_rejects_an_unknown_framework(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name, value in REQUIRED_TRACING_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("AGENT_FRAMEWORK", "custom")
    sys.modules.pop("agent_server.agent", None)
    monkeypatch.setattr(server, "_invoke_function", None)
    monkeypatch.setattr(server, "_stream_function", None)

    with pytest.raises(
        RuntimeError, match="AGENT_FRAMEWORK must be 'langgraph' or 'openai'"
    ):
        importlib.import_module("agent_server.agent")


def test_agent_import_reports_every_missing_tracing_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_FRAMEWORK", "langgraph")
    for name in REQUIRED_TRACING_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(mlflow.langchain, "autolog", lambda **kwargs: None)
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    monkeypatch.setattr(server, "_invoke_function", None)
    monkeypatch.setattr(server, "_stream_function", None)

    with pytest.raises(RuntimeError) as caught:
        importlib.import_module("agent_server.agent")

    for name in REQUIRED_TRACING_ENV:
        assert name in str(caught.value)


def test_tracing_config_reports_every_invalid_identifier_and_table() -> None:
    from agent_server.tracing import validate_tracing_environment

    invalid = {
        "MLFLOW_TRACKING_URI": "databricks",
        "MLFLOW_EXPERIMENT_ID": "not-an-id",
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "not-a-warehouse",
        "MLFLOW_UC_CATALOG": "bad.catalog",
        "MLFLOW_UC_SCHEMA": "bad-schema",
        "MLFLOW_UC_TABLE_PREFIX": "1bad-prefix",
        "MLFLOW_OTEL_SPANS_TABLE": "other.schema.unrelated_otel_spans",
    }

    with pytest.raises(RuntimeError) as caught:
        validate_tracing_environment(invalid)

    for name in (
        "MLFLOW_EXPERIMENT_ID",
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
        "MLFLOW_UC_CATALOG",
        "MLFLOW_UC_SCHEMA",
        "MLFLOW_UC_TABLE_PREFIX",
        "MLFLOW_OTEL_SPANS_TABLE",
    ):
        assert name in str(caught.value)


def test_preflight_fails_when_selected_autologger_did_not_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name, value in REQUIRED_TRACING_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("AGENT_FRAMEWORK", "langgraph")
    monkeypatch.setattr(mlflow.langchain, "autolog", lambda **kwargs: None)
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    tracing = importlib.import_module("agent_server.tracing")
    monkeypatch.setattr(tracing, "mark_autologger_called", lambda framework: None)
    monkeypatch.setattr(server, "_invoke_function", None)
    monkeypatch.setattr(server, "_stream_function", None)

    with pytest.raises(RuntimeError, match="selected autologger did not run"):
        preflight.verify_agent_tracing()


def test_deployment_preflight_rejects_wrong_uc_location_and_missing_warehouse() -> None:
    wrong_location = UnityCatalog("wrong_catalog", "wrong_schema", "wrong_prefix")
    wrong_location._otel_spans_table_name = (
        "wrong_catalog.wrong_schema.wrong_prefix_otel_spans"
    )
    experiment = Experiment(
        experiment_id="123",
        name="wrong-location",
        artifact_location="dbfs:/tmp/test",
        lifecycle_stage="active",
        trace_location=wrong_location,
    )

    class LocalMlflowClient:
        def get_experiment(self, _experiment_id):
            return experiment

    class LocalWarehouses:
        def get(self, _warehouse_id):
            raise RuntimeError("warehouse does not exist")

    workspace = type("Workspace", (), {"warehouses": LocalWarehouses()})()
    config = {
        "MLFLOW_TRACKING_URI": "databricks",
        "MLFLOW_EXPERIMENT_ID": "123",
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
        "MLFLOW_UC_CATALOG": "catalog_test",
        "MLFLOW_UC_SCHEMA": "schema_test",
        "MLFLOW_UC_TABLE_PREFIX": "migration_test",
        "MLFLOW_OTEL_SPANS_TABLE": (
            "catalog_test.schema_test.migration_test_otel_spans"
        ),
    }

    with pytest.raises(RuntimeError) as caught:
        preflight.verify_deployment_trace_resources(
            config,
            mlflow_client=LocalMlflowClient(),
            workspace_client=workspace,
        )

    assert "wrong UC trace location" in str(caught.value)
    assert "warehouse does not exist" in str(caught.value)


def test_real_deployment_preflight_verifies_resources_before_server_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = dict(REQUIRED_TRACING_ENV)
    monkeypatch.setattr(sys, "argv", ["preflight.py"])
    monkeypatch.setattr(preflight, "verify_agent_tracing", lambda: config)

    def reject_resources(_config):
        raise RuntimeError("deployment resources are unavailable")

    monkeypatch.setattr(
        preflight, "verify_deployment_trace_resources", reject_resources
    )

    def server_must_not_start():
        raise AssertionError("server setup ran before deployment resource verification")

    monkeypatch.setattr(preflight, "find_free_port", server_must_not_start)

    with pytest.raises(RuntimeError, match="deployment resources are unavailable"):
        preflight.main()


def test_deployment_preflight_rejects_deleted_warehouse_state() -> None:
    location = UnityCatalog("catalog_test", "schema_test", "migration_test")
    location._otel_spans_table_name = (
        "catalog_test.schema_test.migration_test_otel_spans"
    )
    experiment = Experiment(
        experiment_id="123",
        name="correct-location",
        artifact_location="dbfs:/tmp/test",
        lifecycle_stage="active",
        trace_location=location,
    )

    class LocalMlflowClient:
        def get_experiment(self, _experiment_id):
            return experiment

    class LocalWarehouses:
        def get(self, warehouse_id):
            return type("Warehouse", (), {"id": warehouse_id, "state": "DELETED"})()

    workspace = type("Workspace", (), {"warehouses": LocalWarehouses()})()
    config = {
        "MLFLOW_TRACKING_URI": "databricks",
        "MLFLOW_EXPERIMENT_ID": "123",
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
        "MLFLOW_UC_CATALOG": "catalog_test",
        "MLFLOW_UC_SCHEMA": "schema_test",
        "MLFLOW_UC_TABLE_PREFIX": "migration_test",
        "MLFLOW_OTEL_SPANS_TABLE": (
            "catalog_test.schema_test.migration_test_otel_spans"
        ),
    }

    with pytest.raises(RuntimeError, match="state: DELETED"):
        preflight.verify_deployment_trace_resources(
            config,
            mlflow_client=LocalMlflowClient(),
            workspace_client=workspace,
        )


@pytest.mark.filterwarnings(
    "ignore:The ``noload`` loader strategy is deprecated:sqlalchemy.exc.SADeprecationWarning"
)
def test_preflight_fails_when_smoke_trace_cannot_be_retrieved(tmp_path) -> None:
    original_tracking_uri = mlflow.get_tracking_uri()
    tracking_uri = f"sqlite:///{tmp_path / 'tracking.db'}"
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.MlflowClient().create_experiment("empty-smoke-test")

    try:
        with pytest.raises(RuntimeError, match="smoke trace was not retrievable"):
            preflight.verify_smoke_trace(
                experiment_id=experiment_id,
                started_ms=0,
                request_id="missing-smoke-request",
                timeout_seconds=0,
            )
    finally:
        mlflow.set_tracking_uri(original_tracking_uri)


def test_smoke_retrieval_rejects_unrelated_newer_trace(tmp_path: Path) -> None:
    original_tracking_uri = mlflow.get_tracking_uri()
    tracking_uri = f"sqlite:///{tmp_path / 'busy-tracking.db'}"
    artifact_dir = tmp_path / "busy-artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "busy-smoke-test", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)

    try:
        started_ms = 0
        with mlflow.start_span("unrelated", span_type=SpanType.AGENT):
            mlflow.update_current_trace(
                metadata={"appkit.request.id": "unrelated-request"}
            )

        with pytest.raises(RuntimeError, match="exact smoke trace was not retrievable"):
            preflight.verify_smoke_trace(
                experiment_id=experiment_id,
                started_ms=started_ms,
                request_id="target-smoke-request",
                timeout_seconds=0,
            )
    finally:
        mlflow.set_tracking_uri(original_tracking_uri)


def test_smoke_retrieval_matches_root_request_attribute(tmp_path: Path) -> None:
    original_tracking_uri = mlflow.get_tracking_uri()
    tracking_uri = f"sqlite:///{tmp_path / 'attribute-tracking.db'}"
    artifact_dir = tmp_path / "attribute-artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "attribute-smoke-test", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)

    try:
        with mlflow.start_span("matching", span_type=SpanType.AGENT) as root:
            root.set_attribute("appkit.request.id", "attribute-smoke-request")

        assert preflight.verify_smoke_trace(
            experiment_id=experiment_id,
            started_ms=0,
            request_id="attribute-smoke-request",
            timeout_seconds=0,
        )
    finally:
        mlflow.set_tracking_uri(original_tracking_uri)


def test_smoke_invocation_carries_unique_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed_payload: dict = {}

    class LocalResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps({"output": [{"type": "message"}]}).encode()

    def local_urlopen(request, timeout):
        assert timeout == preflight.REQUEST_TIMEOUT
        observed_payload.update(json.loads(request.data))
        return LocalResponse()

    monkeypatch.setattr(preflight.urllib.request, "urlopen", local_urlopen)

    assert preflight.check_invocations(
        "http://local.invalid", request_id="unique-smoke-request", retries=0
    )
    assert observed_payload["custom_inputs"]["request_id"] == "unique-smoke-request"


def test_migration_handler_attaches_request_identity_to_trace(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    tracking_uri = f"sqlite:///{tmp_path / 'identity.db'}"
    artifact_dir = tmp_path / "identity-artifacts"
    artifact_dir.mkdir()
    original_tracking_uri = mlflow.get_tracking_uri()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "migration-handler-identity", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    for name, value in REQUIRED_TRACING_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    monkeypatch.setenv("AGENT_FRAMEWORK", "langgraph")
    monkeypatch.setattr(mlflow.langchain, "autolog", lambda **_kwargs: None)
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    monkeypatch.setattr(server, "_invoke_function", None)
    monkeypatch.setattr(server, "_stream_function", None)
    reset_config()

    try:
        agent = importlib.import_module("agent_server.agent")
        request = ResponsesAgentRequest(
            input=[{"role": "user", "content": "hello"}],
            user="migration-user",
            custom_inputs={
                "session_id": "migration-session",
                "request_id": "migration-request",
            },
        )

        async def consume_scaffold():
            await agent.stream_handler(request)

        with mlflow.start_span("migration.request", span_type=SpanType.AGENT):
            with pytest.raises(NotImplementedError):
                asyncio.run(consume_scaffold())

        traces = mlflow.search_traces(
            locations=[experiment_id], return_type="list", flush=True
        )
        trace = mlflow.get_trace(traces[0].info.trace_id, flush=True)
        assert trace.info.trace_metadata["mlflow.trace.session"] == "migration-session"
        assert trace.info.trace_metadata["mlflow.trace.user"] == "migration-user"
        assert trace.info.trace_metadata["appkit.request.id"] == "migration-request"
        assert trace.info.tags["template"] == "agent-migration-from-model-serving"
    finally:
        reset_config()
        mlflow.set_tracking_uri(original_tracking_uri)


def test_offline_preflight_proves_autologging_and_trace_retrieval() -> None:
    env = os.environ.copy()
    for name in (*REQUIRED_TRACING_ENV, "DATABRICKS_HOST", "DATABRICKS_TOKEN"):
        env.pop(name, None)
    env["AGENT_FRAMEWORK"] = "langgraph"

    completed = subprocess.run(
        [sys.executable, "scripts/preflight.py", "--offline-test"],
        cwd=PROJECT_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert (
        "TEST-ONLY: synthetic local tracing configuration; "
        "deployment UC validation is not performed" in completed.stdout
    )
    assert "selected autologger ran: langgraph" in completed.stdout
    assert "smoke trace retrieved:" in completed.stdout
    assert not (PROJECT_ROOT / "mlruns").exists()


@pytest.mark.parametrize("framework", ["langgraph", "openai"])
def test_selected_autologger_exports_only_sanitized_bounded_spans(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, framework: str
) -> None:
    tracking_uri = f"sqlite:///{tmp_path / f'{framework}.db'}"
    artifact_dir = tmp_path / f"{framework}-artifacts"
    artifact_dir.mkdir()
    original_tracking_uri = mlflow.get_tracking_uri()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        f"migration-{framework}-sanitizer", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    for name, value in REQUIRED_TRACING_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    monkeypatch.setenv("AGENT_FRAMEWORK", framework)
    monkeypatch.setattr(mlflow.langchain, "autolog", lambda **_kwargs: None)
    monkeypatch.setattr(mlflow.openai, "autolog", lambda **_kwargs: None)
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    monkeypatch.setattr(server, "_invoke_function", None)
    monkeypatch.setattr(server, "_stream_function", None)
    reset_config()

    try:
        importlib.import_module("agent_server.agent")
        tracing = importlib.import_module("agent_server.tracing")
        with mlflow.start_span("framework.agent", span_type=SpanType.AGENT) as root:
            tracing.set_request_trace_identity(
                session_id="token identity-session-value",
                user_id="identity-user",
                request_id="identity-request",
                template_name="identity-template",
            )
            root.set_inputs(
                {
                    "headers": {
                        "Authorization": "Bearer auth-header-value",
                        "Cookie": "session=cookie-header-value",
                    },
                    "api_key": "api-key-value",
                }
            )
            root.set_outputs(
                {
                    "sdk_token": "sdk-token-value",
                    "Set-Cookie": "tool-session=cookie-output-value",
                }
            )
            root.set_attribute(
                "tool.credentials",
                {"username": "tool-user", "password": "tool-password-value"},
            )
            with mlflow.start_span("framework.tool", span_type=SpanType.TOOL) as tool:
                tool.set_inputs(
                    {
                        "payload": "x" * 70_000,
                        "credentials": {"secret": "tool-secret-value"},
                    }
                )
                tool.set_outputs({"authorization": "Bearer tool-output-value"})
                tool.set_attribute("sdk.context", {"token": "attribute-token-value"})
            root.record_exception(
                RuntimeError("authorization Bearer exception-token-value")
            )

        traces = mlflow.search_traces(
            locations=[experiment_id], return_type="list", flush=True
        )
        trace = mlflow.get_trace(traces[0].info.trace_id, flush=True)
        exported = json.dumps(
            [span.to_dict() for span in trace.data.spans], sort_keys=True
        )
        for secret in (
            "auth-header-value",
            "cookie-header-value",
            "api-key-value",
            "sdk-token-value",
            "cookie-output-value",
            "tool-password-value",
            "tool-secret-value",
            "tool-output-value",
            "attribute-token-value",
            "exception-token-value",
            "identity-session-value",
        ):
            assert secret not in exported
        assert "[REDACTED]" in exported
        tool_span = next(
            span for span in trace.data.spans if span.span_type == SpanType.TOOL
        )
        assert tool_span.inputs["truncated"] is True
        assert tool_span.inputs["originalBytes"] > 64 * 1024
    finally:
        reset_config()
        mlflow.set_tracking_uri(original_tracking_uri)
