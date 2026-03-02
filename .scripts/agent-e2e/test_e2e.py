import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

import pytest

from helpers import (
    _log,
    apply_edits,
    bundle_deploy,
    bundle_destroy,
    bundle_run,
    capture_app_logs,
    clean_template,
    get_oauth_token,
    grant_lakebase_access,
    query_deployed_with_openai_sdk,
    query_endpoint,
    query_endpoint_stream,
    revert_edits,
    run_evaluate,
    run_quickstart,
    run_test_agent,
    set_log_file,
    start_server,
    stop_server,
    wait_for_app_ready,
)
from template_config import FileEdit, TemplateConfig, build_templates

CONVERSATIONAL_PAYLOAD = {"input": [{"role": "user", "content": "What is 2+2?"}]}
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


def pytest_generate_tests(metafunc):
    """Build templates from CLI options and parametrize at collection time."""
    if "template" in metafunc.fixturenames:
        config = metafunc.config
        templates = build_templates(
            genie_space_id=config.getoption("--genie-space-id"),
            serving_endpoint=config.getoption("--serving-endpoint"),
            knowledge_assistant_endpoint=config.getoption(
                "--knowledge-assistant-endpoint"
            ),
        )
        template_filter = config.getoption("--template")
        if template_filter:
            templates = [t for t in templates if t.name == template_filter]
        metafunc.parametrize("template", templates, ids=lambda t: t.name)


def _query_endpoints(
    template: TemplateConfig,
    base_url: str,
    token: str | None = None,
):
    """Test non-streaming and streaming endpoints. Shared by local and deploy phases."""
    auth_headers = {"Authorization": f"Bearer {token}"} if token else None

    if template.is_conversational:
        result = query_endpoint(base_url, CONVERSATIONAL_PAYLOAD, "/responses", auth_headers)
        assert "output" in result, f"/responses missing 'output': {result}"

        result = query_endpoint(base_url, CONVERSATIONAL_PAYLOAD, "/invocations", auth_headers)
        assert "output" in result, f"/invocations missing 'output': {result}"

        query_endpoint_stream(base_url, CONVERSATIONAL_PAYLOAD, "/responses", auth_headers)
    else:
        result = query_endpoint(
            base_url, NON_CONVERSATIONAL_PAYLOAD, "/invocations", auth_headers
        )
        assert "results" in result, f"/invocations missing 'results': {result}"
        assert len(result["results"]) > 0, "No results returned"


def _run_local(template: TemplateConfig, template_dir: Path, log_file: Path):
    """Local phase: start server -> curl endpoints -> stop server -> evaluate."""
    set_log_file(log_file)
    _log(f"\n{'='*60}")
    _log(f"LOCAL PHASE: {template.name}")
    _log(f"{'='*60}")
    proc, port = start_server(template_dir)
    base_url = f"http://localhost:{port}"
    try:
        _query_endpoints(template, base_url)
    finally:
        stop_server(proc)

    if template.has_evaluate:
        run_evaluate(template_dir)
    elif not template.is_conversational:
        run_test_agent(template_dir)


def _run_deploy(
    template: TemplateConfig,
    template_dir: Path,
    profile: str,
    lakebase: str,
    log_file: Path,
):
    """Deploy phase: bundle deploy -> run -> grant perms -> wait -> query -> destroy."""
    set_log_file(log_file)
    _log(f"\n{'='*60}")
    _log(f"DEPLOY PHASE: {template.name}")
    _log(f"{'='*60}")
    bundle_deploy(template_dir, profile)
    bundle_run(template_dir, template.bundle_name, profile)
    try:
        if template.needs_lakebase_edit:
            grant_lakebase_access(template.dev_app_name, lakebase, profile)

        app_url = wait_for_app_ready(template.dev_app_name, profile)
        token = get_oauth_token(profile)

        try:
            if template.is_conversational:
                output_text = query_deployed_with_openai_sdk(
                    app_url, token, "What is 2+2?"
                )
                assert output_text, "OpenAI SDK returned empty response"

            _query_endpoints(template, app_url, token)
        except Exception:
            logs = capture_app_logs(template.dev_app_name, profile)
            if logs:
                _log(
                    f"\n--- App logs for {template.dev_app_name} ---\n"
                    f"{logs}\n--- End logs ---"
                )
            raise
    finally:
        bundle_destroy(template_dir, profile)


def test_e2e(template, repo_root, profile, lakebase, request):
    """Full e2e test: clean -> quickstart -> edits -> (local || deploy) -> revert."""
    skip_local = request.config.getoption("--skip-local")
    skip_deploy = request.config.getoption("--skip-deploy")

    template_dir = repo_root / template.name

    # Setup log file for this template
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / f"{template.name}.log"
    log_file.write_text("")  # clear previous run
    set_log_file(log_file)

    # Snapshot databricks.yml before quickstart (quickstart may modify it)
    yml_path = template_dir / "databricks.yml"
    yml_original = yml_path.read_text() if yml_path.exists() else None

    with phase("setup:clean"):
        clean_template(template_dir, profile)

    with phase("setup:quickstart"):
        run_quickstart(
            template_dir, profile, lakebase if template.needs_lakebase_edit else None
        )

    with phase("setup:edits"):
        edits = list(template.pre_test_edits)
        if template.needs_lakebase_edit:
            yml_text = (template_dir / "databricks.yml").read_text()
            if "<your-lakebase-instance-name>" in yml_text:
                edits.append(
                    FileEdit(
                        relative_path="databricks.yml",
                        old="<your-lakebase-instance-name>",
                        new=lakebase,
                    )
                )
        originals = apply_edits(edits, template_dir)

    try:
        if skip_local and skip_deploy:
            pytest.skip("Both --skip-local and --skip-deploy specified")

        if skip_deploy:
            with phase("local"):
                _run_local(template, template_dir, log_file)
            return

        if skip_local:
            with phase("deploy"):
                _run_deploy(template, template_dir, profile, lakebase, log_file)
            return

        # Run local and deploy in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            local_future: Future = executor.submit(
                _run_local, template, template_dir, log_file
            )
            deploy_future: Future = executor.submit(
                _run_deploy, template, template_dir, profile, lakebase, log_file
            )

            errors: list[str] = []
            for name, future in [("local", local_future), ("deploy", deploy_future)]:
                try:
                    future.result()
                except Exception as exc:
                    errors.append(
                        f"{name}:\n{''.join(traceback.format_exception(exc))}"
                    )

            if errors:
                raise AssertionError(
                    "Failures in parallel phases:\n" + "\n".join(errors)
                )
    finally:
        revert_edits(originals)
        # Restore databricks.yml to pre-quickstart state (quickstart replaces placeholders)
        if yml_original is not None:
            yml_path.write_text(yml_original)
