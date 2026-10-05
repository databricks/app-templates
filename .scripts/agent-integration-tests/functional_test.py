"""Functional e2e orchestrator. Serial; run with -p no:xdist.
  uv run --no-sync pytest functional_test.py --val-template <name> --target local|deployed

Report rendering lives in conftest.py's pytest_terminal_summary (extended there),
not here -- a hook defined inside a test module may not fire reliably.
"""
from __future__ import annotations
import os
from pathlib import Path
import pytest
from functional_config import FUNCTIONAL_TEMPLATES, missing_resources
from local_launch import launch_local, teardown
from functional_runners import (
    run_node_playwright, run_py_playwright, run_mcp, run_agent_api,
    deployed_auth_ok, looks_like_login_page,
)
from template_config import REPO_ROOT

AUTH_DIR = Path(__file__).parent / ".auth"


def pytest_generate_tests(metafunc):
    if "ft" in metafunc.fixturenames:
        items = list(FUNCTIONAL_TEMPLATES.values())
        only = metafunc.config.getoption("--val-template")
        if only:
            items = [t for t in items if t.name in only]
        metafunc.parametrize("ft", items, ids=lambda t: t.name)


def _record(row: dict) -> None:
    store = getattr(pytest, "_functional_results", None)
    if store is None:
        store = pytest._functional_results = []
    store.append(row)


def _run_test(ft, base_url, storage_state, token):
    kind = ft.test["kind"]
    tdir = REPO_ROOT / ft.name
    if kind == "node-playwright":
        run_node_playwright(tdir, base_url, storage_state,
                             project=ft.test.get("project"), grep=ft.test.get("grep"))
    elif kind == "py-playwright":
        run_py_playwright(tdir, ft.test["spec"], base_url, storage_state)
    elif kind == "mcp":
        run_mcp(base_url)
    elif kind == "agent-api":
        run_agent_api(base_url, token)
    else:
        raise ValueError(kind)


def test_functional(ft, request):
    target = request.config.getoption("--target")
    row = {"template": ft.name, "family": ft.family, "local": "skip", "deployed": "skip", "notes": ""}
    missing = missing_resources(ft, os.environ)
    if missing:
        row["notes"] = f"missing creds: {','.join(missing)}"
        _record(row)
        pytest.skip(row["notes"])

    try:
        if target == "local":
            proc, base_url = launch_local(ft, REPO_ROOT / ft.name)
            try:
                _run_test(ft, base_url, None, None)
                row["local"] = "pass"
            finally:
                teardown(proc)
        else:  # deployed
            only = request.config.getoption("--val-template")
            if len(only) != 1:
                row["notes"] = "deployed runs one template at a time (shared app); pass a single --val-template"
                _record(row)
                pytest.skip(row["notes"])
            from validate_templates import wait_for_app_ready_generic
            from validation_config import load_validation_config, DEFAULT_CONFIG_PATH
            cfg = load_validation_config(DEFAULT_CONFIG_PATH)
            app_url, token = wait_for_app_ready_generic(cfg.shared_app_name, cfg.profile)
            state = AUTH_DIR / "dogfood.json"
            storage = str(state) if state.exists() else None
            if ft.test["kind"] in ("node-playwright", "py-playwright"):
                if not storage:
                    row["notes"] = "no storageState -- run auth_setup first"
                    _record(row)
                    pytest.skip(row["notes"])
                if not deployed_auth_ok(app_url, storage):
                    row["notes"] = "storageState expired — re-run auth_setup"
                    _record(row)
                    pytest.skip(row["notes"])
            _run_test(ft, app_url, storage, token)
            row["deployed"] = "pass"
    except Exception as exc:
        row["local" if target == "local" else "deployed"] = "fail"
        row["notes"] = str(exc)[:300]
        _record(row)
        raise
    _record(row)
