import pytest

from template_config import (
    DEFAULT_GENIE_SPACE_ID,
    DEFAULT_LAKEBASE_AUTOSCALING_ENDPOINT,
    DEFAULT_PROFILE,
    DEFAULT_SERVING_ENDPOINT,
    DEFAULT_TARGET_APP_NAME,
    REPO_ROOT,
)


def pytest_addoption(parser):
    parser.addoption("--profile", default=DEFAULT_PROFILE, help="Databricks CLI profile")
    parser.addoption(
        "--lakebase-autoscaling-endpoint",
        default=DEFAULT_LAKEBASE_AUTOSCALING_ENDPOINT,
        help="Lakebase autoscaling endpoint (e.g. projects/my-project/branches/my-branch/endpoints/primary)",
    )
    parser.addoption("--template", action="append", default=None, help="Run only these templates (repeatable)")
    parser.addoption(
        "--genie-space-id",
        default=DEFAULT_GENIE_SPACE_ID,
        help="Genie space ID for multiagent template",
    )
    parser.addoption(
        "--serving-endpoint",
        default=DEFAULT_SERVING_ENDPOINT,
        help="Serving endpoint name for multiagent template",
    )
    parser.addoption(
        "--target-app-name",
        default=DEFAULT_TARGET_APP_NAME,
        help="Target app name for the multiagent template's app-to-app CAN_USE permission",
    )
    parser.addoption(
        "--skip-local", action="store_true", default=False, help="Skip local testing"
    )
    parser.addoption(
        "--skip-deploy", action="store_true", default=False, help="Skip deploy testing"
    )
    parser.addoption(
        "--no-destroy",
        action="store_true",
        default=False,
        help="Skip bundle destroy (keep app running for inspection)",
    )
    # Quickstart e2e test options
    parser.addoption(
        "--quickstart-only",
        action="store_true",
        default=False,
        help="Skip deploy phase in quickstart e2e tests (only validate quickstart output)",
    )
    parser.addoption(
        "--git-ref",
        default=None,
        help="Test quickstart against a specific git ref (branch/commit) instead of working tree",
    )
    parser.addoption(
        "--scenario",
        action="append",
        default=None,
        help="Run only specific quickstart e2e scenarios (repeatable): fresh-and-idempotent, existing-app, lakebase-idempotent",
    )
    parser.addoption("--config", action="store", default=None,
                     help="Path to validation-config.yaml (validate_templates.py)")
    parser.addoption("--val-template", action="append", default=[],
                     help="Limit validation to these template names (repeatable)")
    parser.addoption("--val-setup-only", action="store_true", default=False,
                     help="Only ensure the shared app exists; skip deploy/verify")


@pytest.fixture
def profile(request):
    return request.config.getoption("--profile")


@pytest.fixture
def lakebase_autoscaling_endpoint(request):
    return request.config.getoption("--lakebase-autoscaling-endpoint")


@pytest.fixture
def repo_root():
    return REPO_ROOT


def pytest_runtest_logreport(report):
    # Record the outcome of the "call" phase (and setup-only skips) for
    # validation-runner tests. Ignore everything else (e.g. agent e2e).
    if "validate_templates.py::test_validate_template" not in report.nodeid:
        return
    if report.when == "call" or (report.when == "setup" and report.outcome == "skipped"):
        store = getattr(pytest, "_val_results", None)
        if store is None:
            store = pytest._val_results = {}
        # nodeid ends with [<template>]
        name = report.nodeid.split("[", 1)[1].rstrip("]")
        store[name] = {"outcome": report.outcome, "duration": getattr(report, "duration", 0.0)}


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    store = getattr(pytest, "_val_results", None)
    if not store:
        return
    from pathlib import Path

    from validate_templates import render_report
    from validation_config import DEFAULT_CONFIG_PATH, load_validation_config

    cfg_path = Path(config.getoption("--config") or DEFAULT_CONFIG_PATH)
    cfg = load_validation_config(cfg_path, resolve_workspace_root=False)
    verify_by_name = {t.name: t.verify for t in cfg.templates}

    rows = []
    for name, res in store.items():
        verify = verify_by_name.get(name, "?")
        mode = "build" if verify == "build" else "deploy"
        rows.append({
            "template": name, "mode": mode, "verify": verify,
            "outcome": res["outcome"], "duration": res["duration"],
        })
    report_md = render_report(rows)
    out = Path(__file__).parent / "logs" / "validation-report.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(report_md)
    terminalreporter.write_line(f"\nValidation report written to {out}")
