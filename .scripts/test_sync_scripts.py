"""Regression tests for shared script synchronization."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
SYNC_SCRIPT = REPO_ROOT / ".scripts" / "sync-scripts.py"
MIGRATION_TEMPLATE = "agent-migration-from-model-serving"


def _load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def synced_migration_preflight(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.syspath_prepend(str(SYNC_SCRIPT.parent))
    sync = _load_module(SYNC_SCRIPT, "sync_scripts_under_test")
    template_root = tmp_path / MIGRATION_TEMPLATE
    (template_root / "scripts").mkdir(parents=True)

    config = {
        **sync.TEMPLATES[MIGRATION_TEMPLATE],
        "exclude_scripts": [
            source_name
            for source_name, _ in sync.SCRIPTS_TO_SYNC
            if source_name != "preflight.py"
        ],
    }
    monkeypatch.setattr(sync, "REPO_ROOT", tmp_path)
    assert sync.sync_scripts(MIGRATION_TEMPLATE, config) == ["preflight.py"]

    generated_path = template_root / "scripts" / "preflight.py"
    return _load_module(generated_path, "generated_migration_preflight")


def test_migration_preflight_has_explicit_canonical_owner() -> None:
    sys.path.insert(0, str(SYNC_SCRIPT.parent))
    try:
        sync = _load_module(SYNC_SCRIPT, "sync_scripts_ownership_test")
    finally:
        sys.path.remove(str(SYNC_SCRIPT.parent))

    assert sync.TEMPLATES[MIGRATION_TEMPLATE].get("script_sources") == {
        "preflight.py": "agent-migration-from-model-serving/preflight.py"
    }


def test_sync_preserves_deployment_tracing_validation(
    synced_migration_preflight: ModuleType,
) -> None:
    preflight = synced_migration_preflight
    assert callable(getattr(preflight, "verify_deployment_trace_resources", None))
    config = {
        "MLFLOW_EXPERIMENT_ID": "123",
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
        "MLFLOW_UC_CATALOG": "main",
        "MLFLOW_UC_SCHEMA": "agent_traces",
        "MLFLOW_UC_TABLE_PREFIX": "agents_on_apps",
        "MLFLOW_OTEL_SPANS_TABLE": "main.agent_traces.agents_on_apps_otel_spans",
    }
    mlflow_client = SimpleNamespace(get_experiment=lambda _experiment_id: None)

    def missing_warehouse(_warehouse_id: str):
        raise RuntimeError("warehouse missing")

    workspace_client = SimpleNamespace(
        warehouses=SimpleNamespace(get=missing_warehouse)
    )

    with pytest.raises(RuntimeError, match="Deployment tracing preflight failed"):
        preflight.verify_deployment_trace_resources(
            config,
            mlflow_client=mlflow_client,
            workspace_client=workspace_client,
        )


def test_sync_preserves_exact_smoke_trace_retrieval(
    synced_migration_preflight: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preflight = synced_migration_preflight
    assert callable(getattr(preflight, "verify_smoke_trace", None))
    foreign = SimpleNamespace(
        info=SimpleNamespace(
            timestamp_ms=200,
            trace_id="foreign-trace",
            trace_metadata={"appkit.request.id": "another-request"},
        )
    )
    monkeypatch.setattr(
        preflight.mlflow, "get_tracking_uri", lambda: "sqlite:///test.db"
    )
    monkeypatch.setattr(preflight.mlflow, "search_traces", lambda **_kwargs: [foreign])
    monkeypatch.setattr(
        preflight.mlflow,
        "get_trace",
        lambda _trace_id, flush: pytest.fail("foreign trace must not be retrieved"),
    )

    with pytest.raises(RuntimeError, match="exact smoke trace was not retrievable"):
        preflight.verify_smoke_trace(
            experiment_id="123",
            started_ms=100,
            request_id="expected-request",
            timeout_seconds=0,
        )


def test_sync_preserves_offline_preflight_mode(
    synced_migration_preflight: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    preflight = synced_migration_preflight
    assert callable(getattr(preflight, "run_offline_test", None))
    offline_calls: list[bool] = []
    monkeypatch.setattr(sys, "argv", ["preflight.py", "--offline-test"])
    monkeypatch.setattr(
        preflight, "run_offline_test", lambda: offline_calls.append(True)
    )
    monkeypatch.setattr(
        preflight,
        "find_free_port",
        lambda: pytest.fail("offline mode must not start the server"),
    )

    preflight.main()

    assert offline_calls == [True]
