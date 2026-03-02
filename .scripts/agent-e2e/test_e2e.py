import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

import pytest

from helpers import (
    apply_edits,
    bundle_deploy,
    bundle_destroy,
    capture_app_logs,
    clean_template,
    get_oauth_token,
    grant_lakebase_access,
    query_deployed_non_conversational,
    query_deployed_with_openai_sdk,
    query_endpoint,
    query_endpoint_stream,
    query_endpoint_stream_with_auth,
    query_endpoint_with_auth,
    revert_edits,
    run_evaluate,
    run_quickstart,
    run_test_agent,
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
    try:
        yield
    except Exception as exc:
        raise type(exc)(f"[{name}] {exc}") from exc


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


def _run_local(template: TemplateConfig, template_dir: Path):
    """Local phase: start server -> curl endpoints -> stop server -> evaluate."""
    proc, port = start_server(template_dir)
    base_url = f"http://localhost:{port}"
    try:
        if template.is_conversational:
            result = query_endpoint(base_url, CONVERSATIONAL_PAYLOAD, "/responses")
            assert "output" in result, f"/responses missing 'output': {result}"

            result = query_endpoint(base_url, CONVERSATIONAL_PAYLOAD, "/invocations")
            assert "output" in result, f"/invocations missing 'output': {result}"

            query_endpoint_stream(base_url, CONVERSATIONAL_PAYLOAD, "/responses")
        else:
            result = query_endpoint(
                base_url, NON_CONVERSATIONAL_PAYLOAD, "/invocations"
            )
            assert "results" in result, f"/invocations missing 'results': {result}"
            assert len(result["results"]) > 0, "No results returned"
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
):
    """Deploy phase: bundle deploy -> grant perms -> wait -> query -> destroy."""
    bundle_deploy(template_dir, profile)
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

                result = query_endpoint_with_auth(
                    app_url, token, CONVERSATIONAL_PAYLOAD, "/invocations"
                )
                assert "output" in result, f"/invocations missing 'output': {result}"

                query_endpoint_stream_with_auth(
                    app_url, token, CONVERSATIONAL_PAYLOAD, "/responses"
                )
            else:
                result = query_deployed_non_conversational(app_url, token)
                assert len(result["results"]) > 0, "No results returned"
        except Exception:
            logs = capture_app_logs(template.dev_app_name, profile)
            if logs:
                print(
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
                _run_local(template, template_dir)
            return

        if skip_local:
            with phase("deploy"):
                _run_deploy(template, template_dir, profile, lakebase)
            return

        # Run local and deploy in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            local_future: Future = executor.submit(
                _run_local, template, template_dir
            )
            deploy_future: Future = executor.submit(
                _run_deploy, template, template_dir, profile, lakebase
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
