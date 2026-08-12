import importlib
import os
from pathlib import Path
import subprocess
import sys

import mlflow.langchain
import mlflow.openai
import pytest
from mlflow.genai.agent_server import server
from scripts import preflight


REQUIRED_TRACING_ENV = {
    "MLFLOW_TRACKING_URI": "file:///tmp/appkit-migration-test-tracking",
    "MLFLOW_EXPERIMENT_ID": "1",
    "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "warehouse-test",
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
                timeout_seconds=0,
            )
    finally:
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
    assert "selected autologger ran: langgraph" in completed.stdout
    assert "smoke trace retrieved:" in completed.stdout
    assert not (PROJECT_ROOT / "mlruns").exists()
