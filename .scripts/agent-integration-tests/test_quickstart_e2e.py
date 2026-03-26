"""End-to-end tests for the quickstart developer journey.

These tests validate the full developer setup experience — from a fresh
git-clean template copy through quickstart configuration and Databricks
deployment — using real cloud credentials.

Unlike test_e2e.py (which tests agent *runtime* behavior), these tests
validate the *setup experience*: quickstart correctness, idempotency,
and deployment binding.

## Scenarios

| ID | Template | What it tests | Deploys? |
|----|----------|---------------|----------|
| fresh-and-idempotent | agent-langgraph | Normal first run + re-run reuses same experiment | Yes |
| existing-app | agent-langgraph | Pre-created app → quickstart binds it on deploy | Yes |
| lakebase-idempotent | agent-langgraph-advanced | Re-run reuses existing Lakebase config | No |

## Usage

    cd .scripts/agent-integration-tests

    # All scenarios (local quickstart + deploy)
    uv run pytest test_quickstart_e2e.py -v

    # Skip deploy — only validate quickstart output (~1-2 min per scenario)
    uv run pytest test_quickstart_e2e.py -v --quickstart-only

    # Single scenario
    uv run pytest test_quickstart_e2e.py -v --scenario fresh-and-idempotent

    # Test against a specific git branch
    uv run pytest test_quickstart_e2e.py -v --git-ref main --scenario fresh-and-idempotent

    # Keep apps running after test
    uv run pytest test_quickstart_e2e.py -v --scenario existing-app --no-destroy
"""

import secrets
import re
from pathlib import Path

import pytest

from helpers import (
    _log,
    _run_cmd,
    bundle_deploy,
    bundle_destroy,
    databricks_create_app,
    databricks_delete_app,
    git_copy_template,
    read_env_value,
    run_quickstart,
    set_log_file,
    wait_for_app_ready,
)

# Fresh app startups can take 5-15 minutes depending on workspace load
BUNDLE_RUN_FRESH_TIMEOUT = 900  # 15 minutes


def _bundle_run(workdir: Path, app_resource_key: str, profile: str):
    """Run bundle run with an extended timeout for fresh app startups."""
    result = _run_cmd(
        ["databricks", "bundle", "run", app_resource_key, "--target", "dev", "-p", profile],
        cwd=workdir,
        timeout=BUNDLE_RUN_FRESH_TIMEOUT,
    )
    assert result.returncode == 0, (
        f"bundle run failed for {app_resource_key}:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )

# ---------------------------------------------------------------------------
# Scenario definitions
# ---------------------------------------------------------------------------

ALL_SCENARIOS = ["fresh-and-idempotent", "existing-app", "lakebase-idempotent"]


def _unique_app_name(template_name: str) -> str:
    """Generate a unique app name: qs-{initials}-{hex6}.

    e.g. "agent-langgraph" → "qs-lg-a1b2c3" (14 chars max)
    """
    short_parts = template_name.removeprefix("agent-").split("-")
    initials = "".join(p[0] for p in short_parts)[:4]
    return f"qs-{initials}-{secrets.token_hex(3)}"


def _parse_app_resource_key(yml_path: Path) -> str:
    """Extract the DAB resource key from databricks.yml."""
    content = yml_path.read_text()
    match = re.search(r"resources:\s*\n\s+apps:\s*\n\s+(\w+):", content, re.MULTILINE)
    assert match, f"Could not find app resource key in {yml_path}"
    return match.group(1)


def _parse_app_name_from_yml(yml_path: Path) -> str:
    """Extract the app name (quoted) from databricks.yml."""
    content = yml_path.read_text()
    match = re.search(r'\bname:\s+"([^"]+)"', content)
    assert match, f"Could not find quoted app name in {yml_path}"
    return match.group(1)


# ---------------------------------------------------------------------------
# Parametrize
# ---------------------------------------------------------------------------


def pytest_generate_tests(metafunc):
    if "scenario" in metafunc.fixturenames:
        selected = metafunc.config.getoption("--scenario") or ALL_SCENARIOS
        metafunc.parametrize("scenario", selected)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def profile(request):
    return request.config.getoption("--profile")


@pytest.fixture
def lakebase(request):
    return request.config.getoption("--lakebase")


@pytest.fixture
def quickstart_only(request):
    return request.config.getoption("--quickstart-only")


@pytest.fixture
def git_ref(request):
    return request.config.getoption("--git-ref")


@pytest.fixture
def no_destroy(request):
    return request.config.getoption("--no-destroy")


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------


def test_quickstart_e2e(
    tmp_path,
    scenario,
    profile,
    lakebase,
    quickstart_only,
    git_ref,
    no_destroy,
):
    """Validate the full quickstart developer journey for each scenario."""
    log_file = Path(__file__).parent / "logs" / f"quickstart-{scenario}.log"
    log_file.parent.mkdir(exist_ok=True)
    log_file.write_text("")
    set_log_file(log_file)

    if scenario == "fresh-and-idempotent":
        _run_fresh_and_idempotent(tmp_path, profile, quickstart_only, no_destroy, git_ref)
    elif scenario == "existing-app":
        _run_existing_app(tmp_path, profile, quickstart_only, no_destroy, git_ref)
    elif scenario == "lakebase-idempotent":
        _run_lakebase_idempotent(tmp_path, profile, lakebase, git_ref)
    else:
        pytest.fail(f"Unknown scenario: {scenario}")


# ---------------------------------------------------------------------------
# Scenario implementations
# ---------------------------------------------------------------------------


def _run_fresh_and_idempotent(
    tmp_path: Path,
    profile: str,
    quickstart_only: bool,
    no_destroy: bool,
    git_ref: str | None,
):
    """Scenario A: fresh first run, then idempotent re-run reuses same experiment.

    Steps:
    1. Copy agent-langgraph via git ls-files (respects .gitignore)
    2. First quickstart run: creates MLflow experiment, writes .env
    3. Second quickstart run: should reuse the same experiment (idempotency)
    4. Assert same MLFLOW_EXPERIMENT_ID before and after second run
    5. Deploy and verify app reaches RUNNING state (unless --quickstart-only)
    """
    template_name = "agent-langgraph"
    app_name = _unique_app_name(template_name)
    workdir = git_copy_template(template_name, tmp_path, git_ref)

    _log(f"[fresh-and-idempotent] workdir={workdir}, app_name={app_name}")

    # First quickstart run
    _log("[fresh-and-idempotent] Step 1: First quickstart run")
    run_quickstart(workdir, profile, app_name=app_name, skip_lakebase=True)

    env_file = workdir / ".env"
    assert env_file.exists(), ".env not created by quickstart"
    exp_id_1 = read_env_value(env_file, "MLFLOW_EXPERIMENT_ID")
    assert exp_id_1, "MLFLOW_EXPERIMENT_ID not set in .env after first run"
    _log(f"[fresh-and-idempotent] experiment ID after first run: {exp_id_1}")

    # Second quickstart run (idempotency)
    _log("[fresh-and-idempotent] Step 2: Second quickstart run (idempotency check)")
    result = run_quickstart(workdir, profile, skip_lakebase=True)

    exp_id_2 = read_env_value(env_file, "MLFLOW_EXPERIMENT_ID")
    assert exp_id_2 == exp_id_1, (
        f"Idempotency failure: second run created new experiment "
        f"{exp_id_2!r} != {exp_id_1!r}"
    )
    assert "Reusing existing experiment" in result.stdout, (
        "Expected 'Reusing existing experiment' in quickstart output"
    )
    _log("[fresh-and-idempotent] Idempotency check passed")

    # Verify databricks.yml was configured
    yml_path = workdir / "databricks.yml"
    deployed_app_name = _parse_app_name_from_yml(yml_path)
    assert deployed_app_name == app_name, (
        f"databricks.yml app name mismatch: {deployed_app_name!r} != {app_name!r}"
    )

    if quickstart_only:
        _log("[fresh-and-idempotent] --quickstart-only set, skipping deploy")
        return

    # Deploy and verify
    app_resource_key = _parse_app_resource_key(yml_path)
    _log(f"[fresh-and-idempotent] Deploying app {app_name} (resource key: {app_resource_key})")
    try:
        bundle_deploy(workdir, profile, app_resource_key, app_name)
        _bundle_run(workdir, app_resource_key, profile)
        wait_for_app_ready(app_name, profile)
        _log("[fresh-and-idempotent] App reached RUNNING state and responded to /agent/info")
    finally:
        if not no_destroy:
            bundle_destroy(workdir, profile)
            databricks_delete_app(app_name, profile)


def _run_existing_app(
    tmp_path: Path,
    profile: str,
    quickstart_only: bool,
    no_destroy: bool,
    git_ref: str | None,
):
    """Scenario B: pre-created app → quickstart --app-name → deploy binds it.

    Simulates the common workflow where a user has already created an app in
    the Databricks UI and wants to deploy their template to it.

    Steps:
    1. Pre-create a bare app (simulates UI-created app)
    2. Copy agent-langgraph via git ls-files
    3. Run quickstart with --app-name pointing to the pre-created app
    4. Assert databricks.yml has the correct app name
    5. Deploy — should bind to the pre-created app without "already exists" error
    """
    template_name = "agent-langgraph"
    app_name = _unique_app_name(template_name)

    _log(f"[existing-app] Pre-creating app {app_name}")
    databricks_create_app(app_name, profile)

    workdir = git_copy_template(template_name, tmp_path, git_ref)
    _log(f"[existing-app] workdir={workdir}, app_name={app_name}")

    try:
        # Run quickstart pointing at the pre-created app
        _log("[existing-app] Running quickstart with --app-name")
        run_quickstart(workdir, profile, app_name=app_name, skip_lakebase=True)

        env_file = workdir / ".env"
        assert env_file.exists(), ".env not created by quickstart"
        exp_id = read_env_value(env_file, "MLFLOW_EXPERIMENT_ID")
        assert exp_id, "MLFLOW_EXPERIMENT_ID not set in .env"

        yml_path = workdir / "databricks.yml"
        deployed_app_name = _parse_app_name_from_yml(yml_path)
        assert deployed_app_name == app_name, (
            f"databricks.yml app name mismatch: {deployed_app_name!r} != {app_name!r}"
        )
        _log(f"[existing-app] databricks.yml configured with app_name={app_name}")

        if quickstart_only:
            _log("[existing-app] --quickstart-only set, skipping deploy")
            return

        # Deploy — bundle deploy's recovery logic binds to the pre-existing app
        app_resource_key = _parse_app_resource_key(yml_path)
        _log(f"[existing-app] Deploying (resource key: {app_resource_key})")
        bundle_deploy(workdir, profile, app_resource_key, app_name)
        _bundle_run(workdir, app_resource_key, profile)
        wait_for_app_ready(app_name, profile)
        _log("[existing-app] App reached RUNNING state")

    finally:
        if not no_destroy:
            bundle_destroy(workdir, profile)
            databricks_delete_app(app_name, profile)


def _run_lakebase_idempotent(
    tmp_path: Path,
    profile: str,
    lakebase: str,
    git_ref: str | None,
):
    """Scenario C: Lakebase idempotency — re-running quickstart reuses existing config.

    Steps:
    1. Copy agent-langgraph-advanced via git ls-files
    2. First quickstart run: configures Lakebase, writes LAKEBASE_INSTANCE_NAME to .env
    3. Second quickstart run (no --lakebase flag): should reuse config from .env
    4. Assert same LAKEBASE_INSTANCE_NAME after both runs

    No deployment — this tests quickstart behavior only.
    """
    template_name = "agent-langgraph-advanced"
    app_name = _unique_app_name(template_name)
    workdir = git_copy_template(template_name, tmp_path, git_ref)

    _log(f"[lakebase-idempotent] workdir={workdir}, lakebase={lakebase}")

    # First run: configure Lakebase
    _log("[lakebase-idempotent] Step 1: First quickstart run with --lakebase-provisioned-name")
    run_quickstart(workdir, profile, lakebase=lakebase, app_name=app_name)

    env_file = workdir / ".env"
    assert env_file.exists(), ".env not created by quickstart"
    instance_1 = read_env_value(env_file, "LAKEBASE_INSTANCE_NAME")
    assert instance_1 == lakebase, (
        f"LAKEBASE_INSTANCE_NAME not set correctly: {instance_1!r} != {lakebase!r}"
    )
    _log(f"[lakebase-idempotent] LAKEBASE_INSTANCE_NAME after first run: {instance_1}")

    # Second run: no lakebase flag — should reuse from .env
    _log("[lakebase-idempotent] Step 2: Second quickstart run (no --lakebase flag)")
    result = run_quickstart(workdir, profile)

    instance_2 = read_env_value(env_file, "LAKEBASE_INSTANCE_NAME")
    assert instance_2 == instance_1, (
        f"Idempotency failure: second run changed LAKEBASE_INSTANCE_NAME "
        f"{instance_2!r} != {instance_1!r}"
    )
    assert "Reusing existing Lakebase config" in result.stdout, (
        "Expected 'Reusing existing Lakebase config' in quickstart output"
    )
    _log("[lakebase-idempotent] Lakebase idempotency check passed")
