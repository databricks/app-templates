import copy
import os
import re
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
from helpers import (
    _log,
    apply_edits,
    bundle_deploy,
    bundle_destroy,
    bundle_run_nowait,
    capture_app_logs,
    clean_template,
    copy_template,
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
    uv_sync,
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


def _template_id(t: TemplateConfig) -> str:
    """Generate a unique test ID like 'agent-langgraph-advanced[autoscaling]'."""
    if t.lakebase_type:
        return f"{t.name}[{t.lakebase_type}]"
    return t.name


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


def pytest_generate_tests(metafunc):
    """Build templates from CLI options and parametrize at collection time.

    Lakebase variants are filtered based on available config:
    - Provisioned variants require --lakebase-provisioned-name
    - Autoscaling variants require --lakebase-autoscaling-endpoint
    If neither is provided, all lakebase variants are excluded.
    """
    if "template" in metafunc.fixturenames:
        config = metafunc.config
        templates = build_templates(
            genie_space_id=config.getoption("--genie-space-id"),
            serving_endpoint=config.getoption("--serving-endpoint"),
        )

        has_provisioned = bool(config.getoption("--lakebase-provisioned-name"))
        has_autoscaling = bool(config.getoption("--lakebase-autoscaling-endpoint"))

        # Filter out lakebase variants that can't run with available config
        filtered = []
        for t in templates:
            if t.lakebase_type == "provisioned" and not has_provisioned:
                continue
            if t.lakebase_type == "autoscaling" and not has_autoscaling:
                continue
            filtered.append(t)
        templates = filtered

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


def _extract_response_text(result: dict) -> str:
    """Extract text content from ALL assistant messages in a response.

    Some templates (e.g. long-term memory) return multiple assistant messages
    (one before a tool call, one after), so we collect text from all of them.
    """
    parts: list[str] = []
    for item in result.get("output", []):
        if item.get("type") == "message" and item.get("role") == "assistant":
            content = item.get("content", "")
            if isinstance(content, list):
                parts.append(
                    " ".join(
                        c.get("text", "") for c in content if c.get("type") == "output_text"
                    )
                )
            else:
                parts.append(str(content))
    if parts:
        return " ".join(parts)
    # Fallback: check for output_text at top level
    if "output_text" in result:
        return result["output_text"]
    return str(result.get("output", ""))


def _test_statefulness(
    template: TemplateConfig,
    base_url: str,
    token: str | None = None,
):
    """Test session memory persistence for advanced templates."""
    auth_headers = {"Authorization": f"Bearer {token}"} if token else None

    session_id = str(uuid.uuid4())
    _log(f"Testing session memory with session {session_id}")

    # Determine custom_inputs key based on SDK
    if "langgraph" in template.name:
        id_key = "thread_id"
    else:
        id_key = "session_id"

    # First message: set a fact
    payload1 = {
        "input": [{"role": "user", "content": "My favorite color is purple"}],
        "custom_inputs": {id_key: session_id},
    }
    result1 = query_endpoint(base_url, payload1, "/invocations", auth_headers)
    assert "output" in result1, f"First statefulness query missing 'output': {result1}"

    # Second message: recall the fact
    payload2 = {
        "input": [{"role": "user", "content": "What is my favorite color?"}],
        "custom_inputs": {id_key: session_id},
    }
    result2 = query_endpoint(base_url, payload2, "/invocations", auth_headers)
    assert "output" in result2, f"Second statefulness query missing 'output': {result2}"

    response_text = _extract_response_text(result2)
    assert "purple" in response_text.lower(), (
        f"Session memory test failed: expected 'purple' in response, got: {response_text}"
    )
    _log("Session memory test PASSED")


def _test_long_term_memory(
    template: TemplateConfig,
    base_url: str,
    token: str | None = None,
):
    """Test long-term memory persistence across sessions (langgraph-advanced only)."""
    auth_headers = {"Authorization": f"Bearer {token}"} if token else None
    user_id = f"test-ltm-{uuid.uuid4().hex[:8]}@example.com"
    _log(f"Testing long-term memory with user {user_id}")

    # Session 1: store a fact
    payload1 = {
        "input": [{"role": "user", "content": "Remember that my favorite color is purple"}],
        "custom_inputs": {"thread_id": str(uuid.uuid4()), "user_id": user_id},
    }
    result1 = query_endpoint(base_url, payload1, "/invocations", auth_headers)
    assert "output" in result1, f"First LTM query missing 'output': {result1}"

    # Session 2 (different thread, same user): recall the fact
    payload2 = {
        "input": [{"role": "user", "content": "What is my favorite color?"}],
        "custom_inputs": {"thread_id": str(uuid.uuid4()), "user_id": user_id},
    }
    result2 = query_endpoint(base_url, payload2, "/invocations", auth_headers)
    assert "output" in result2, f"Second LTM query missing 'output': {result2}"

    response_text = _extract_response_text(result2)
    assert "purple" in response_text.lower(), (
        f"Long-term memory test failed: expected 'purple' in response, got: {response_text}"
    )
    _log("Long-term memory test PASSED")


def _run_local(
    template: TemplateConfig,
    template_dir: Path,
    log_file: Path,
    server_started_event: threading.Event | None = None,
):
    """Local phase: start server -> curl endpoints -> stop server -> evaluate."""
    set_log_file(log_file)
    _log(f"\n{'=' * 60}")
    _log(f"LOCAL PHASE: {template.name} [{template.lakebase_type or 'no-lakebase'}]")
    _log(f"{'=' * 60}")
    try:
        proc, port = start_server(template_dir)
    finally:
        # Signal deploy thread that server has started (or failed to start),
        # so it's safe to modify pyproject.toml for deploy.
        if server_started_event:
            server_started_event.set()
    base_url = f"http://localhost:{port}"
    try:
        _query_endpoints(template, base_url)
        if template.is_advanced:
            _test_statefulness(template, base_url)
            if "langgraph" in template.name:
                _test_long_term_memory(template, base_url)
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
    lakebase_provisioned_name: str,
    log_file: Path,
    no_destroy: bool = False,
    lakebase_autoscaling_endpoint: str | None = None,
    server_started_event: threading.Event | None = None,
):
    """Deploy phase: bundle deploy -> grant perms -> run -> wait -> query -> destroy."""
    set_log_file(log_file)
    _log(f"\n{'=' * 60}")
    _log(f"DEPLOY PHASE: {template.name} [{template.lakebase_type or 'no-lakebase'}]")
    _log(f"{'=' * 60}")
    # Wait for local server to start before bundle_deploy, which may strip
    # [tool.uv.sources] from pyproject.toml — if uv is still resolving deps
    # in the local thread, the strip would break it.
    if server_started_event:
        _log("Waiting for local server to start before deploying...")
        server_started_event.wait(timeout=120)
        _log("Local server started, proceeding with deploy")
    bundle_deploy(template_dir, profile, template.app_resource_key, template.dev_app_name)
    if template.needs_lakebase:
        _grant_kwargs = {}
        if template.lakebase_type == "provisioned":
            _grant_kwargs["instance_name"] = lakebase_provisioned_name
        elif template.lakebase_type == "autoscaling":
            _grant_kwargs["autoscaling_endpoint"] = lakebase_autoscaling_endpoint
        if _grant_kwargs:
            grant_lakebase_access(template.dev_app_name, profile, **_grant_kwargs)
    bundle_run_nowait(template_dir, template.app_resource_key, profile)
    try:
        app_url, token = wait_for_app_ready(template.dev_app_name, profile)

        # Retry endpoint queries to handle transient 502s and permission errors.
        # The first request may trigger table/sequence creation by the app, so
        # we re-run lakebase grants after a failure to cover newly created objects.
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
                    # Re-grant lakebase access to cover tables/sequences
                    # created by the app on its first request
                    if template.needs_lakebase:
                        _grant_kwargs = {}
                        if template.lakebase_type == "provisioned":
                            _grant_kwargs["instance_name"] = lakebase_provisioned_name
                        elif template.lakebase_type == "autoscaling":
                            _grant_kwargs["autoscaling_endpoint"] = lakebase_autoscaling_endpoint
                        if _grant_kwargs:
                            _log("Re-running lakebase grants to cover newly created objects...")
                            grant_lakebase_access(template.dev_app_name, profile, **_grant_kwargs)
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


def test_e2e(template, repo_root, profile, lakebase_provisioned_name, lakebase_autoscaling_endpoint, request):
    """Full e2e test: clean -> quickstart -> edits -> (local || deploy) -> revert."""
    os.environ["DATABRICKS_CONFIG_PROFILE"] = profile

    skip_local = request.config.getoption("--skip-local")
    skip_deploy = request.config.getoption("--skip-deploy")
    no_destroy = request.config.getoption("--no-destroy")

    if skip_local and skip_deploy:
        pytest.skip("Both --skip-local and --skip-deploy specified")

    # Provisioned lakebase variants use a temp copy so they can run in parallel
    # with the autoscaling variant (which uses the original directory).
    use_temp_copy = template.lakebase_type == "provisioned"
    original_dir = repo_root / template.name

    if use_temp_copy:
        template_dir = copy_template(original_dir)
        # Re-parse the patched databricks.yml to get the new app name
        yml_text = (template_dir / "databricks.yml").read_text()
        app_match = re.search(
            r'^\s*apps:\s*\n\s*(\w+):\s*\n\s*name:\s*"([^"]+)"', yml_text, re.MULTILINE
        )
        assert app_match, f"Could not find app name in patched databricks.yml"
        template = copy.copy(template)
        template.dev_app_name = app_match.group(2).replace("${bundle.target}", "dev")
    else:
        template_dir = original_dir

    # Determine log file name with lakebase type suffix for memory templates
    log_suffix = f"-{template.lakebase_type}" if template.lakebase_type else ""
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / f"{template.name}{log_suffix}.log"
    log_file.write_text("")  # clear previous run
    set_log_file(log_file)

    # Snapshot files that setup may modify (only needed for non-temp dirs)
    yml_path = template_dir / "databricks.yml"
    yml_original = yml_path.read_text() if yml_path.exists() else None

    app_yaml_path = template_dir / "app.yaml"
    app_yaml_original = app_yaml_path.read_text() if app_yaml_path.exists() else None

    env_path = template_dir / ".env"

    try:
        # Deploy-only: skip setup (clean/quickstart/edits) — assume template is
        # already configured from a prior local run or manual setup.
        if skip_local:
            with phase("setup:edits"):
                edits = list(template.pre_test_edits)
                originals = apply_edits(edits, template_dir)
            try:
                with phase("deploy"):
                    _run_deploy(
                        template, template_dir, profile, lakebase_provisioned_name,
                        log_file, no_destroy, lakebase_autoscaling_endpoint,
                    )
                return
            finally:
                revert_edits(originals)

        with phase("setup:clean"):
            clean_template(template_dir)

        with phase("setup:uv-sync"):
            uv_sync(template_dir)

        with phase("setup:quickstart"):
            if template.needs_lakebase:
                if template.lakebase_type == "autoscaling":
                    run_quickstart(
                        template_dir,
                        profile,
                        lakebase_autoscaling_endpoint=lakebase_autoscaling_endpoint,
                    )
                else:
                    run_quickstart(template_dir, profile, lakebase=lakebase_provisioned_name)
            else:
                run_quickstart(template_dir, profile, skip_lakebase=True)

        with phase("setup:edits"):
            edits = list(template.pre_test_edits)
            originals = apply_edits(edits, template_dir)

        try:
            if skip_deploy:
                with phase("local"):
                    _run_local(template, template_dir, log_file)
                return

            # Run local and deploy in parallel
            # Deploy may strip [tool.uv.sources] from pyproject.toml, so it
            # must wait for the local server to finish starting first.
            server_started = threading.Event()
            with ThreadPoolExecutor(max_workers=2) as executor:
                local_future: Future = executor.submit(
                    _run_local, template, template_dir, log_file, server_started,
                )
                deploy_future: Future = executor.submit(
                    _run_deploy, template, template_dir, profile, lakebase_provisioned_name,
                    log_file, no_destroy, lakebase_autoscaling_endpoint, server_started,
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
            if not use_temp_copy:
                # Restore databricks.yml to pre-quickstart state
                if yml_original is not None:
                    yml_path.write_text(yml_original)
                # Restore app.yaml to pre-quickstart state
                if app_yaml_original is not None:
                    app_yaml_path.write_text(app_yaml_original)
                # Remove .env created by quickstart
                if env_path.exists():
                    env_path.unlink()
    finally:
        if use_temp_copy:
            shutil.rmtree(template_dir.parent, ignore_errors=True)
