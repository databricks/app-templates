from concurrent.futures import ThreadPoolExecutor, Future
from pathlib import Path

import pytest

from helpers import (
    apply_edits,
    bundle_deploy,
    clean_template,
    get_app_url,
    get_oauth_token,
    kill_port,
    query_deployed_non_conversational,
    query_deployed_with_openai_sdk,
    query_endpoint,
    query_endpoint_with_auth,
    revert_edits,
    run_evaluate,
    run_quickstart,
    run_test_agent,
    start_server,
    stop_server,
    wait_for_app_ready,
)
from template_config import TEMPLATES, FileEdit, TemplateConfig

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


def _run_local(template: TemplateConfig, template_dir: Path):
    """Local phase: start server -> curl endpoints -> stop server -> evaluate."""
    kill_port(8000)
    proc = start_server(template_dir)
    try:
        if template.is_conversational:
            result = query_endpoint(
                "http://localhost:8000", CONVERSATIONAL_PAYLOAD, "/responses"
            )
            assert "output" in result, f"/responses missing 'output': {result}"

            result = query_endpoint(
                "http://localhost:8000", CONVERSATIONAL_PAYLOAD, "/invocations"
            )
            assert "output" in result, f"/invocations missing 'output': {result}"
        else:
            result = query_endpoint(
                "http://localhost:8000", NON_CONVERSATIONAL_PAYLOAD, "/invocations"
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
):
    """Deploy phase: bundle deploy -> wait -> query endpoints."""
    bundle_deploy(template_dir, profile)
    wait_for_app_ready(template.dev_app_name, profile)

    app_url = get_app_url(template.dev_app_name, profile)
    token = get_oauth_token(profile)

    if template.is_conversational:
        output_text = query_deployed_with_openai_sdk(app_url, token, "What is 2+2?")
        assert output_text, "OpenAI SDK returned empty response"

        result = query_endpoint_with_auth(
            app_url, token, CONVERSATIONAL_PAYLOAD, "/invocations"
        )
        assert "output" in result, f"/invocations missing 'output': {result}"
    else:
        result = query_deployed_non_conversational(app_url, token)
        assert len(result["results"]) > 0, "No results returned"


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t.name)
def test_e2e(template, repo_root, profile, lakebase, request):
    """Full e2e test: clean -> quickstart -> edits -> (local || deploy) -> revert."""
    skip_local = request.config.getoption("--skip-local")
    skip_deploy = request.config.getoption("--skip-deploy")

    template_dir = repo_root / template.name

    # Fresh start
    clean_template(template_dir)

    # Quickstart (only pass lakebase for templates that need it)
    run_quickstart(
        template_dir, profile, lakebase if template.needs_lakebase_edit else None
    )

    # Apply all edits up front (pre_test_edits + lakebase for databricks.yml)
    edits = list(template.pre_test_edits)
    if template.needs_lakebase_edit:
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
            _run_local(template, template_dir)
            return

        if skip_local:
            _run_deploy(template, template_dir, profile)
            return

        # Run local and deploy in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            local_future: Future = executor.submit(
                _run_local, template, template_dir
            )
            deploy_future: Future = executor.submit(
                _run_deploy, template, template_dir, profile
            )

            # Collect results — .result() re-raises any exception from the thread
            errors: list[str] = []
            for name, future in [("local", local_future), ("deploy", deploy_future)]:
                try:
                    future.result()
                except Exception as exc:
                    errors.append(f"{name}: {exc}")

            if errors:
                raise AssertionError(
                    f"Failures in parallel phases:\n" + "\n".join(errors)
                )
    finally:
        revert_edits(originals)
