import os
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
from helpers import (
    _log,
    add_autoscaling_postgres_resource,
    apply_edits,
    bundle_deploy,
    bundle_destroy,
    bundle_run,
    capture_app_logs,
    clean_template,
    get_oauth_token,
    grant_lakebase_access,
    query_endpoint,
    query_with_openai_sdk,
    revert_edits,
    run_evaluate,
    run_quickstart,
    run_test_agent,
    set_log_file,
    start_server,
    stop_server,
    wait_for_app_ready,
)
from template_config import TemplateConfig, build_templates

CONVERSATIONAL_PAYLOAD = {"input": [{"role": "user", "content": "What time is it? Use the get_current_time tool."}]}
NON_CONVERSATIONAL_PAYLOAD = {
    "document_text": (
        "Total assets: $2,300,000. Total liabilities: $1,200,000. "
        "Shareholder's equity: $1,100,000. Net income: $450,000. "
        "Revenues: $1,700,000. Expenses: $1,250,000."
    ),
    "questions": [
        "Do the documents contain a balance sheet?",
        "Do the documents contain an income statement?",
    ],
}


def _assert_tool_time_in_result(result: dict):
    """Assert the result contains a get_current_time tool output with today's date."""
    now_utc = datetime.now(timezone.utc)
    now_local = datetime.now()
    valid_dates = {now_utc.date(), now_local.date()}

    for item in result.get("output", []):
        if item.get("type") == "function_call_output":
            output = item.get("output", "")
            try:
                tool_time = datetime.fromisoformat(output).replace(tzinfo=None)
                assert tool_time.date() in valid_dates, (
                    f"Tool time {output} date not today (expected one of {valid_dates})"
                )
                return
            except ValueError:
                continue
    assert False, f"No function_call_output with ISO datetime found in result: {result}"


@contextmanager
def phase(name: str):
    """Wrap a test phase so exceptions carry a [phase] prefix."""
    _log(f"\n--- Phase: {name} ---")
    try:
        yield
    except Exception as exc:
        _log(f"Phase {name} FAILED: {exc}")
        raise RuntimeError(f"[{name}] {exc}") from exc
    _log(f"Phase {name} completed")


def _template_id(t: TemplateConfig) -> str:
    """Generate a unique test ID for a template config."""
    if t.lakebase_type:
        return f"{t.name}[{t.lakebase_type}]"
    return t.name


def pytest_generate_tests(metafunc):
    """Build templates from CLI options and parametrize at collection time."""
    if "template" in metafunc.fixturenames:
        config = metafunc.config
        templates = build_templates(
            genie_space_id=config.getoption("--genie-space-id"),
            serving_endpoint=config.getoption("--serving-endpoint"),
        )
        template_filter = config.getoption("--template")
        if template_filter:
            templates = [t for t in templates if t.name in template_filter]
        metafunc.parametrize("template", templates, ids=_template_id)


def _query_endpoints(
    template: TemplateConfig,
    base_url: str,
    token: str | None = None,
):
    """Test all endpoints: curl non-streaming, curl streaming, and OpenAI SDK.

    Shared by local and deploy phases. When token is None (local), the OpenAI SDK
    uses a dummy key; when token is provided (deploy), it authenticates with Bearer.
    """
    auth_headers = {"Authorization": f"Bearer {token}"} if token else None

    if template.is_conversational:
        # curl: non-streaming /responses and /invocations
        result = query_endpoint(base_url, CONVERSATIONAL_PAYLOAD, "/responses", auth_headers)
        assert "output" in result, f"/responses missing 'output': {result}"
        if template.validate_time:
            _assert_tool_time_in_result(result)

        result = query_endpoint(base_url, CONVERSATIONAL_PAYLOAD, "/invocations", auth_headers)
        assert "output" in result, f"/invocations missing 'output': {result}"
        if template.validate_time:
            _assert_tool_time_in_result(result)

        # curl: streaming /responses and /invocations
        query_endpoint(base_url, CONVERSATIONAL_PAYLOAD, "/responses", auth_headers, stream=True)
        query_endpoint(base_url, CONVERSATIONAL_PAYLOAD, "/invocations", auth_headers, stream=True)

        # OpenAI SDK: non-streaming and streaming
        output_text = query_with_openai_sdk(base_url, token, "What time is it?")
        assert output_text, "OpenAI SDK returned empty response"

        output_text = query_with_openai_sdk(base_url, token, "What time is it?", stream=True)
        assert output_text, "OpenAI SDK streaming returned empty response"
    else:
        result = query_endpoint(base_url, NON_CONVERSATIONAL_PAYLOAD, "/invocations", auth_headers)
        assert "results" in result, f"/invocations missing 'results': {result}"
        assert len(result["results"]) > 0, "No results returned"


def _run_local(template: TemplateConfig, template_dir: Path, log_file: Path):
    """Local phase: start server -> curl endpoints -> stop server -> evaluate."""
    set_log_file(log_file)
    _log(f"\n{'=' * 60}")
    _log(f"LOCAL PHASE: {template.name}")
    _log(f"{'=' * 60}")
    proc, port = start_server(template_dir)
    base_url = f"http://localhost:{port}"
    try:
        _query_endpoints(template, base_url)
        if template.has_evaluate:
            run_evaluate(template_dir)
        elif not template.is_conversational:
            run_test_agent(template_dir, port)
    finally:
        stop_server(proc)


def _run_deploy(
    template: TemplateConfig,
    template_dir: Path,
    profile: str,
    lakebase: str,
    lakebase_project: str,
    lakebase_branch: str,
    log_file: Path,
    no_destroy: bool = False,
):
    """Deploy phase: bundle deploy -> grant perms -> run -> wait -> query -> destroy."""
    set_log_file(log_file)
    _log(f"\n{'=' * 60}")
    _log(f"DEPLOY PHASE: {template.name} ({template.lakebase_type or 'no-lakebase'})")
    _log(f"{'=' * 60}")
    bundle_deploy(template_dir, profile, template.app_resource_key, template.dev_app_name)
    if template.lakebase_type == "provisioned":
        grant_lakebase_access(template.dev_app_name, lakebase, profile)
    elif template.lakebase_type == "autoscaling":
        add_autoscaling_postgres_resource(
            template.dev_app_name, lakebase_project, lakebase_branch, profile
        )
    bundle_run(template_dir, template.app_resource_key, profile)
    try:
        app_url, token = wait_for_app_ready(template.dev_app_name, profile)

        # Retry endpoint queries to handle transient 502s after lakebase grant
        last_exc = None
        for attempt in range(3):
            try:
                _query_endpoints(template, app_url, token)
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                _log(f"Endpoint query attempt {attempt + 1}/3 failed: {exc}")
                if attempt < 2:
                    token = get_oauth_token(profile)  # refresh token on retry
                    time.sleep(30)
        if last_exc is not None:
            raise last_exc
    except Exception as exc:
        _log(f"\n--- Deploy failure ---\n{''.join(traceback.format_exception(exc))}")
        logs = capture_app_logs(template.dev_app_name, profile)
        if logs:
            _log(f"\n--- App logs for {template.dev_app_name} ---\n{logs}\n--- End logs ---")
        raise
    finally:
        if not no_destroy:
            bundle_destroy(template_dir, profile)
        else:
            _log("--no-destroy: skipping bundle destroy")


def test_e2e(template, repo_root, profile, lakebase, lakebase_project, lakebase_branch, request):
    """Full e2e test: clean -> quickstart -> edits -> (local || deploy) -> revert."""
    os.environ["DATABRICKS_CONFIG_PROFILE"] = profile

    skip_local = request.config.getoption("--skip-local")
    skip_deploy = request.config.getoption("--skip-deploy")
    no_destroy = request.config.getoption("--no-destroy")

    if skip_local and skip_deploy:
        pytest.skip("Both --skip-local and --skip-deploy specified")

    template_dir = repo_root / template.name

    # Setup log file for this template
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    log_suffix = f"-{template.lakebase_type}" if template.lakebase_type else ""
    log_file = log_dir / f"{template.name}{log_suffix}.log"
    log_file.write_text("")  # clear previous run
    set_log_file(log_file)

    # Snapshot files before quickstart (quickstart may modify them)
    yml_path = template_dir / "databricks.yml"
    yml_original = yml_path.read_text() if yml_path.exists() else None
    app_yaml_path = template_dir / "app.yaml"
    app_yaml_original = app_yaml_path.read_text() if app_yaml_path.exists() else None
    env_path = template_dir / ".env"
    env_original = env_path.read_text() if env_path.exists() else None

    with phase("setup:clean"):
        clean_template(template_dir)

    with phase("setup:quickstart"):
        if template.lakebase_type == "provisioned":
            run_quickstart(template_dir, profile, lakebase=lakebase)
        elif template.lakebase_type == "autoscaling":
            run_quickstart(
                template_dir,
                profile,
                lakebase_autoscaling_project=lakebase_project,
                lakebase_autoscaling_branch=lakebase_branch,
            )
        else:
            run_quickstart(template_dir, profile)

    with phase("setup:edits"):
        edits = list(template.pre_test_edits)
        originals = apply_edits(edits, template_dir)

    try:
        if skip_deploy:
            with phase("local"):
                _run_local(template, template_dir, log_file)
            return

        if skip_local:
            with phase("deploy"):
                _run_deploy(
                    template, template_dir, profile, lakebase,
                    lakebase_project, lakebase_branch, log_file, no_destroy,
                )
            return

        # Run local and deploy in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            local_future: Future = executor.submit(_run_local, template, template_dir, log_file)
            deploy_future: Future = executor.submit(
                _run_deploy, template, template_dir, profile, lakebase,
                lakebase_project, lakebase_branch, log_file, no_destroy,
            )

            errors: list[str] = []
            for name, future in [("local", local_future), ("deploy", deploy_future)]:
                try:
                    future.result()
                except Exception as exc:
                    errors.append(f"{name}:\n{''.join(traceback.format_exception(exc))}")

            if errors:
                raise AssertionError("Failures in parallel phases:\n" + "\n".join(errors))
    finally:
        revert_edits(originals)
        # Restore databricks.yml to pre-quickstart state (quickstart replaces placeholders)
        if yml_original is not None:
            yml_path.write_text(yml_original)
        if app_yaml_original is not None:
            app_yaml_path.write_text(app_yaml_original)
        if env_original is not None:
            env_path.write_text(env_original)
        elif env_path.exists():
            env_path.unlink()
