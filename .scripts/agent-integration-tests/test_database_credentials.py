"""Exercise each todo app's real credential and pool code without a live database."""

import importlib.util
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(params=["flask-database-app", "streamlit-database-app", "dash-database-app"])
def database_app(request, monkeypatch):
    # UI frameworks and external I/O are outside this credential/pool test.
    from databricks import sdk

    workspace = mock.MagicMock()
    workspace.database.generate_database_credential.return_value.token = "lakebase-first"
    workspace.database.list_database_instances.return_value = [
        SimpleNamespace(name="bound-instance", read_write_dns="example.invalid", read_only_dns="read.invalid")
    ]
    pool_factory = mock.MagicMock()
    monkeypatch.setattr(sdk, "WorkspaceClient", lambda: workspace)
    monkeypatch.setitem(sys.modules, "psycopg", mock.MagicMock())
    monkeypatch.setitem(sys.modules, "psycopg_pool", SimpleNamespace(ConnectionPool=pool_factory))
    for name in ("flask", "streamlit", "dash", "security", "app_diagnostics"):
        monkeypatch.setitem(sys.modules, name, mock.MagicMock())
    monkeypatch.setenv("DATABRICKS_APP_DIAGNOSTICS", "0")
    for name, value in {
        "PGHOST": "example.invalid", "PGDATABASE": "test", "PGUSER": "test-user",
        "PGPORT": "5432", "PGAPPNAME": "credential-test",
    }.items():
        monkeypatch.setenv(name, value)
    app_dir = REPO_ROOT / request.param
    monkeypatch.syspath_prepend(str(app_dir))
    name = request.param.replace("-", "_")
    spec = importlib.util.spec_from_file_location(name, app_dir / "app.py")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    module.database_instance_name = None
    module.connection_pool = None
    module.postgres_password = None
    module.last_password_refresh = 0
    # A private clock avoids affecting the UI framework or other tests.
    module.time = SimpleNamespace(time=lambda: 1000)
    pool_factory.reset_mock()
    workspace.reset_mock()
    return module, workspace, pool_factory


def test_pool_receives_lakebase_credential(database_app):
    app, workspace, pool_factory = database_app
    app.get_connection()
    connection_string = pool_factory.call_args.args[0]
    assert "password=lakebase-first " in connection_string
    assert "sslmode=require " in connection_string
    assert workspace.database.generate_database_credential.call_args.kwargs["instance_names"] == ["bound-instance"]
    request_id = workspace.database.generate_database_credential.call_args.kwargs["request_id"]
    assert str(uuid.UUID(request_id)) == request_id
    workspace.config.oauth_token.assert_not_called()


def test_cached_credential_reuses_pool(database_app):
    app, workspace, pool_factory = database_app
    app.get_connection()
    app.time.time = lambda: 1100
    app.get_connection()
    assert pool_factory.call_count == 1
    assert workspace.database.generate_database_credential.call_count == 1


def test_refresh_recreates_pool_with_new_credential(database_app):
    app, workspace, pool_factory = database_app
    app.get_connection()
    old_pool = app.connection_pool
    first_request = workspace.database.generate_database_credential.call_args.kwargs["request_id"]
    workspace.database.generate_database_credential.return_value.token = "lakebase-refreshed"
    app.time.time = lambda: 1901
    app.get_connection()
    old_pool.close.assert_called_once()
    assert "password=lakebase-refreshed " in pool_factory.call_args.args[0]
    assert workspace.database.generate_database_credential.call_args.kwargs["request_id"] != first_request
    workspace.config.oauth_token.assert_not_called()


def test_api_failure_does_not_cache_workspace_token(database_app, monkeypatch):
    app, workspace, _ = database_app
    workspace.database.generate_database_credential.side_effect = RuntimeError("credential service unavailable")
    if hasattr(app, "st"):
        monkeypatch.setattr(app.st, "error", lambda message: None)
        monkeypatch.setattr(app.st, "stop", mock.Mock(side_effect=RuntimeError("stopped")))
        with pytest.raises(RuntimeError, match="stopped"):
            app.refresh_oauth_token()
    else:
        assert app.refresh_oauth_token() is False
    assert app.postgres_password is None
    assert app.last_password_refresh == 0
    workspace.config.oauth_token.assert_not_called()


def test_explicit_instance_name_skips_discovery(database_app):
    app, workspace, pool_factory = database_app
    app.database_instance_name = "explicit-instance"
    app.get_connection()
    assert "password=lakebase-first " in pool_factory.call_args.args[0]
    assert workspace.database.generate_database_credential.call_args.kwargs["instance_names"] == ["explicit-instance"]
    workspace.database.list_database_instances.assert_not_called()


def test_read_only_host_resolves_same_instance(database_app, monkeypatch):
    app, workspace, pool_factory = database_app
    monkeypatch.setenv("PGHOST", "read.invalid")
    app.get_connection()
    assert "password=lakebase-first " in pool_factory.call_args.args[0]
    assert workspace.database.generate_database_credential.call_args.kwargs["instance_names"] == ["bound-instance"]


@pytest.mark.parametrize("pg_host", [None, "missing.invalid"])
def test_missing_instance_does_not_open_pool(database_app, monkeypatch, pg_host):
    app, workspace, pool_factory = database_app
    workspace.database.list_database_instances.return_value[0].read_only_dns = None
    if pg_host is None:
        monkeypatch.delenv("PGHOST")
    else:
        monkeypatch.setenv("PGHOST", pg_host)
    if hasattr(app, "st"):
        monkeypatch.setattr(app.st, "error", lambda message: None)
        monkeypatch.setattr(app.st, "stop", mock.Mock(side_effect=RuntimeError("stopped")))
    with pytest.raises(RuntimeError):
        app.get_connection()
    pool_factory.assert_not_called()
    workspace.database.generate_database_credential.assert_not_called()
