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

import importlib.util
import copy
import hashlib
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

import pytest
import requests
from databricks.sdk import WorkspaceClient

import helpers
from helpers import (
    _log,
    _run_cmd,
    bundle_deploy,
    bundle_destroy,
    databricks_create_app,
    databricks_delete_app,
    execute_trace_row_query,
    git_copy_template,
    read_env_value,
    run_quickstart,
    set_log_file,
    wait_for_app_ready,
)
from template_config import (
    DEFAULT_MLFLOW_UC_CATALOG,
    DEFAULT_MLFLOW_UC_SCHEMA,
    DEFAULT_MLFLOW_UC_TABLE_PREFIX,
    REPO_ROOT,
)

TRACE_CONFORMANCE_DIR = REPO_ROOT / ".scripts" / "trace-conformance"
sys.path.insert(0, str(TRACE_CONFORMANCE_DIR))
from contract import assert_trace_contract  # noqa: E402
from normalize import normalize_python_mlflow_trace, normalize_uc_rows  # noqa: E402

# Fresh app startups can take 5-15 minutes depending on workspace load
BUNDLE_RUN_FRESH_TIMEOUT = 900  # 15 minutes
TRACE_PROPAGATION_TIMEOUT = 180
TRACE_REDACT_KEYS = {
    "authorization",
    "proxyauthorization",
    "cookie",
    "setcookie",
    "apikey",
    "xapikey",
    "token",
    "accesstoken",
    "refreshtoken",
    "databrickstoken",
    "sdktoken",
    "password",
    "secret",
    "clientsecret",
    "credential",
    "credentials",
}
REDACTED_TRACE_VALUE = "[REDACTED]"


def _capture_metadata(value: str) -> dict[str, object]:
    encoded = value.encode("utf-8")
    return {
        "original_bytes": len(encoded),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "truncated": False,
    }


def _mlflow_trace_fixture(*, cost_available: bool = False):
    """Return a fake with the public MLflow 3.14 Trace/Span property shape."""
    trace_id = "trace:/main.agent_traces.agents_on_apps/0123456789abcdef"
    request = {
        "custom_inputs": {
            "Authorization": "Bearer request-secret",
            "api_key": "provider-secret",
            "request_label": "uc-smoke",
        },
        "input": [{"role": "user", "content": "Reply with the word traced."}],
    }
    redacted_request_json = (
        '{"custom_inputs":{"Authorization":"[REDACTED]",'
        '"api_key":"[REDACTED]","request_label":"uc-smoke"},'
        '"input":[{"content":"Reply with the word traced.","role":"user"}]}'
    )
    response = {
        "output": [
            {
                "content": [{"text": "traced", "type": "output_text"}],
                "role": "assistant",
                "type": "message",
            }
        ],
        "status": "completed",
    }
    response_json = (
        '{"output":[{"content":[{"text":"traced","type":"output_text"}],'
        '"role":"assistant","type":"message"}],"status":"completed"}'
    )
    root_usage = {
        "cache_creation_input_tokens": 2,
        "cache_read_input_tokens": 3,
        "input_tokens": 7,
        "output_tokens": 2,
        "total_tokens": 9,
    }
    root_attributes = {
        "mlflow.spanType": "AGENT",
        "mlflow.spanInputs": json.loads(redacted_request_json),
        "mlflow.spanOutputs": json.loads(response_json),
        "mlflow.trace.tokenUsage": dict(root_usage),
        "appkit.cost.available": cost_available,
    }
    for key, value in (
        ("mlflow.spanInputs", redacted_request_json),
        ("mlflow.spanOutputs", response_json),
    ):
        for suffix, metadata_value in _capture_metadata(value).items():
            root_attributes[f"{key}.{suffix}"] = metadata_value
    if cost_available:
        root_attributes["mlflow.llm.cost"] = 0.0125

    root = SimpleNamespace(
        trace_id=trace_id,
        span_id="root-span",
        parent_id=None,
        name="planner agent",
        span_type="AGENT",
        inputs=json.loads(redacted_request_json),
        outputs=json.loads(response_json),
        attributes=root_attributes,
    )
    model = SimpleNamespace(
        trace_id=trace_id,
        span_id="model-span",
        parent_id="root-span",
        name="databricks dbx-model",
        span_type="CHAT_MODEL",
        inputs={"messages": [{"role": "user", "content": "Reply"}]},
        outputs={"text": "traced"},
        attributes={
            "mlflow.spanType": "CHAT_MODEL",
            "mlflow.chat.provider": "databricks",
            "gen_ai.provider.name": "databricks",
            "mlflow.chat.model": "dbx-model",
            "gen_ai.request.model": "dbx-model",
            "mlflow.chat.tokenUsage": dict(root_usage),
            "appkit.cache.read_input_tokens": 3,
            "appkit.cache.creation_input_tokens": 2,
            "appkit.cost.available": cost_available,
            **({"mlflow.llm.cost": 0.0125} if cost_available else {}),
        },
    )
    trace = SimpleNamespace(
        info=SimpleNamespace(trace_id=trace_id),
        data=SimpleNamespace(spans=[root, model]),
    )
    return trace, request, response


def test_trace_contract_accepts_complete_redacted_mlflow_314_shape():
    trace, request, response = _mlflow_trace_fixture()
    contract = globals().get("_assert_trace_contract")
    assert contract is not None, "trace contract validator is missing"

    contract(trace, request, response)


@pytest.mark.parametrize(
    "mutation",
    [
        "non-agent-root",
        "duplicate-root",
        "duplicate-provider",
        "mixed-trace",
        "unredacted-input",
        "truncated-input",
        "wrong-aggregate-usage",
        "collapsed-cache-usage",
        "unavailable-cost-present",
        "negative-available-cost",
        "provider-mismatch",
    ],
)
def test_trace_contract_rejects_incomplete_or_duplicate_semantics(mutation):
    trace, request, response = _mlflow_trace_fixture(
        cost_available=mutation == "negative-available-cost"
    )
    root, model = trace.data.spans
    if mutation == "non-agent-root":
        root.span_type = "CHAIN"
        root.attributes["mlflow.spanType"] = "CHAIN"
    elif mutation == "duplicate-root":
        duplicate = copy.deepcopy(root)
        duplicate.span_id = "second-root"
        trace.data.spans.append(duplicate)
    elif mutation == "duplicate-provider":
        duplicate = copy.deepcopy(model)
        duplicate.span_id = "second-model"
        trace.data.spans.append(duplicate)
    elif mutation == "mixed-trace":
        model.trace_id = "trace:/main.agent_traces.agents_on_apps/different"
    elif mutation == "unredacted-input":
        root.inputs = request
        root.attributes["mlflow.spanInputs"] = request
    elif mutation == "truncated-input":
        root.attributes["mlflow.spanInputs.truncated"] = True
    elif mutation == "wrong-aggregate-usage":
        root.attributes["mlflow.trace.tokenUsage"]["total_tokens"] = 8
    elif mutation == "collapsed-cache-usage":
        del root.attributes["mlflow.trace.tokenUsage"][
            "cache_creation_input_tokens"
        ]
    elif mutation == "unavailable-cost-present":
        root.attributes["mlflow.llm.cost"] = 0.0
    elif mutation == "negative-available-cost":
        root.attributes["mlflow.llm.cost"] = -1.0
    elif mutation == "provider-mismatch":
        model.attributes["gen_ai.provider.name"] = "second-provider"

    contract = globals().get("_assert_trace_contract")
    assert contract is not None, "trace contract validator is missing"
    with pytest.raises(AssertionError):
        contract(trace, request, response)


def test_bundle_deploy_retries_while_uc_experiment_access_propagates(
    tmp_path, monkeypatch
):
    permission_error = subprocess.CompletedProcess(
        args=[],
        returncode=1,
        stdout="",
        stderr=(
            "Invalid Experiment resource experiment: User does not have permission "
            "to access Experiment with ID 12345. (403 PERMISSION_DENIED)"
        ),
    )
    success = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
    results = iter([permission_error, success])
    commands = []

    def run_cmd(cmd, **_kwargs):
        commands.append(cmd)
        return next(results)

    monkeypatch.setattr(helpers, "_run_cmd", run_cmd)
    monkeypatch.setattr(helpers.time, "sleep", lambda _seconds: None)

    helpers.bundle_deploy(tmp_path, "DEFAULT", "agent_langgraph", "agent-app")

    assert commands == [
        ["databricks", "bundle", "deploy", "--target", "dev", "-p", "DEFAULT"],
        ["databricks", "bundle", "deploy", "--target", "dev", "-p", "DEFAULT"],
    ]


def test_bundle_deploy_bounds_uc_experiment_access_retries(tmp_path, monkeypatch):
    permission_error = subprocess.CompletedProcess(
        args=[],
        returncode=1,
        stdout="",
        stderr=(
            "Invalid Experiment resource experiment: User does not have permission "
            "to access Experiment with ID 12345. (403 PERMISSION_DENIED)"
        ),
    )
    commands = []

    def run_cmd(cmd, **_kwargs):
        commands.append(cmd)
        return permission_error

    monkeypatch.setattr(helpers, "_run_cmd", run_cmd)
    monkeypatch.setattr(helpers.time, "sleep", lambda _seconds: None)

    with pytest.raises(AssertionError, match="Invalid Experiment resource"):
        helpers.bundle_deploy(tmp_path, "DEFAULT", "agent_langgraph", "agent-app")

    assert len(commands) == helpers.EXPERIMENT_ACCESS_MAX_ATTEMPTS


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


def _load_quickstart_module(workdir: Path):
    """Load the synchronized quickstart so E2E exercises its grant/query helpers."""
    module_name = f"quickstart_e2e_{secrets.token_hex(4)}"
    script_path = workdir / "scripts" / "quickstart.py"
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _copy_template_for_quickstart(
    template_name: str, tmp_path: Path, git_ref: str | None
) -> Path:
    workdir = git_copy_template(template_name, tmp_path, git_ref)
    # A locally generated lock lets the live suite remain runnable when PyPI's
    # index is temporarily unreachable; the copied workdir is still isolated.
    if git_ref is None and (lock := REPO_ROOT / template_name / "uv.lock").exists():
        shutil.copy2(lock, workdir / "uv.lock")
    if git_ref is None and (venv := REPO_ROOT / template_name / ".venv").exists():
        subprocess.run(
            ["cp", "-cR", str(venv), str(workdir / ".venv")],
            check=True,
        )
    return workdir


def _trace_id_from_response(response: requests.Response) -> str:
    if trace_id := response.headers.get("X-MLflow-Trace-Id"):
        return trace_id

    def find_trace_id(value):
        if isinstance(value, dict):
            candidate = value.get("trace_id")
            if isinstance(candidate, str) and candidate:
                return candidate
            for nested in value.values():
                if found := find_trace_id(nested):
                    return found
        elif isinstance(value, list):
            for nested in value:
                if found := find_trace_id(nested):
                    return found
        return ""

    try:
        return find_trace_id(response.json())
    except ValueError:
        return ""


def _normalize_trace_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _redact_trace_value(value):
    if isinstance(value, dict):
        return {
            key: (
                REDACTED_TRACE_VALUE
                if _normalize_trace_key(str(key)) in TRACE_REDACT_KEYS
                else _redact_trace_value(nested)
            )
            for key, nested in sorted(value.items())
        }
    if isinstance(value, list):
        return [_redact_trace_value(nested) for nested in value]
    return value


def _canonical_trace_json(value) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _decode_trace_attribute(value, label: str):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise AssertionError(f"{label} is not valid JSON: {error}") from error
    return value


def _assert_complete_capture(attributes, key: str, expected) -> object:
    actual = _decode_trace_attribute(attributes.get(key), key)
    expected_redacted = _redact_trace_value(expected)
    assert actual not in (None, "", [], {}), f"{key} is empty"
    assert actual == expected_redacted, f"{key} is partial, unredacted, or incorrect"

    encoded = _canonical_trace_json(expected_redacted).encode("utf-8")
    assert attributes.get(f"{key}.truncated") is False, f"{key} was truncated"
    assert attributes.get(f"{key}.original_bytes") == len(encoded), (
        f"{key} original byte count does not cover the complete redacted value"
    )
    assert attributes.get(f"{key}.sha256") == hashlib.sha256(encoded).hexdigest(), (
        f"{key} hash does not cover the complete redacted value"
    )
    serialized = _canonical_trace_json(actual)
    for secret in ("request-secret", "provider-secret"):
        assert secret not in serialized, f"{key} exposed credential-shaped data"
    return actual


def _usage(attributes, key: str) -> dict[str, int]:
    value = _decode_trace_attribute(attributes.get(key), key)
    assert isinstance(value, dict), f"{key} must be an object"
    required = {"input_tokens", "output_tokens", "total_tokens"}
    assert required <= value.keys(), f"{key} is missing base token counts"
    assert all(
        isinstance(count, int) and not isinstance(count, bool) and count >= 0
        for count in value.values()
    ), f"{key} contains an invalid token count"
    assert value["total_tokens"] == value["input_tokens"] + value["output_tokens"], (
        f"{key} total_tokens does not equal input_tokens plus output_tokens"
    )
    return value


def _assert_trace_contract(trace, request, response) -> None:
    spans = list(trace.data.spans)
    assert spans, "MLflow returned a trace without spans"
    trace_id = trace.info.trace_id
    assert isinstance(trace_id, str) and trace_id, "MLflow trace has no trace ID"
    assert all(span.trace_id == trace_id for span in spans), (
        "Returned spans do not all belong to the retrieved trace"
    )

    roots = [span for span in spans if span.parent_id is None]
    assert len(roots) == 1, f"Expected exactly one parentless span, found {len(roots)}"
    root = roots[0]
    assert root.span_type == "AGENT", "Parentless span is not an AGENT"
    assert root.attributes.get("mlflow.spanType") == "AGENT", (
        "Parentless span is missing mlflow.spanType=AGENT"
    )

    span_by_id = {span.span_id: span for span in spans}
    assert len(span_by_id) == len(spans), "Trace contains duplicate span IDs"
    for span in spans:
        if span is root:
            continue
        assert span.parent_id in span_by_id, f"Span {span.name!r} has an unknown parent"
        cursor = span
        visited = set()
        while cursor is not root:
            assert cursor.span_id not in visited, "Trace span tree contains a cycle"
            visited.add(cursor.span_id)
            cursor = span_by_id[cursor.parent_id]

    captured_inputs = _assert_complete_capture(
        root.attributes, "mlflow.spanInputs", request
    )
    captured_outputs = _assert_complete_capture(
        root.attributes, "mlflow.spanOutputs", response
    )
    assert _decode_trace_attribute(root.inputs, "root.inputs") == captured_inputs
    assert _decode_trace_attribute(root.outputs, "root.outputs") == captured_outputs

    models = [span for span in spans if span.span_type == "CHAT_MODEL"]
    assert models, "Trace contains no CHAT_MODEL descendant"
    fingerprints = set()
    aggregate: dict[str, int] = {}
    all_model_costs_available = True
    model_cost = 0.0
    for model in models:
        attributes = model.attributes
        assert attributes.get("mlflow.spanType") == "CHAT_MODEL"
        provider = attributes.get("mlflow.chat.provider")
        assert provider == "databricks", f"Unexpected model provider {provider!r}"
        assert attributes.get("gen_ai.provider.name") == provider, (
            "MLflow and OpenTelemetry provider attributes disagree"
        )
        model_name = attributes.get("mlflow.chat.model")
        assert isinstance(model_name, str) and model_name
        assert attributes.get("gen_ai.request.model") == model_name
        fingerprint = (model.parent_id, model.name, provider, model_name)
        assert fingerprint not in fingerprints, "Duplicate model/provider tree detected"
        fingerprints.add(fingerprint)

        model_usage = _usage(attributes, "mlflow.chat.tokenUsage")
        for key, count in model_usage.items():
            aggregate[key] = aggregate.get(key, 0) + count
        if "cache_read_input_tokens" in model_usage:
            assert attributes.get("appkit.cache.read_input_tokens") == model_usage[
                "cache_read_input_tokens"
            ]
        if "cache_creation_input_tokens" in model_usage:
            assert attributes.get("appkit.cache.creation_input_tokens") == model_usage[
                "cache_creation_input_tokens"
            ]

        available = attributes.get("appkit.cost.available")
        assert isinstance(available, bool), "Model cost availability is not boolean"
        all_model_costs_available = all_model_costs_available and available
        if available:
            cost = attributes.get("mlflow.llm.cost")
            assert isinstance(cost, (int, float)) and not isinstance(cost, bool)
            assert math.isfinite(cost) and cost >= 0, "Model cost is invalid"
            model_cost += float(cost)
        else:
            assert "mlflow.llm.cost" not in attributes, (
                "Unavailable model cost must be omitted"
            )

    root_usage = _usage(root.attributes, "mlflow.trace.tokenUsage")
    assert root_usage == aggregate, "Root usage does not include every model descendant"
    for cache_key in ("cache_read_input_tokens", "cache_creation_input_tokens"):
        if cache_key in aggregate:
            assert root_usage.get(cache_key) == aggregate[cache_key], (
                "Root cache token categories were collapsed"
            )

    root_cost_available = root.attributes.get("appkit.cost.available")
    assert root_cost_available is all_model_costs_available, (
        "Root cost availability does not cover every model descendant"
    )
    if root_cost_available:
        root_cost = root.attributes.get("mlflow.llm.cost")
        assert isinstance(root_cost, (int, float)) and not isinstance(root_cost, bool)
        assert math.isfinite(root_cost) and root_cost >= 0, "Root cost is invalid"
        assert math.isclose(float(root_cost), model_cost), (
            "Root cost does not include every priced model descendant"
        )
    else:
        assert "mlflow.llm.cost" not in root.attributes, (
            "Unavailable root cost must be omitted"
        )


def _verify_uc_trace_smoke(
    workdir: Path,
    app_name: str,
    app_url: str,
    token: str,
    profile: str,
) -> dict[str, str]:
    """Invoke the deployed app and prove the trace exists in MLflow and UC."""
    env_file = workdir / ".env"
    values = {
        name: read_env_value(env_file, name)
        for name in (
            "MLFLOW_EXPERIMENT_ID",
            "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
            "MLFLOW_UC_CATALOG",
            "MLFLOW_UC_SCHEMA",
            "MLFLOW_UC_TABLE_PREFIX",
            "MLFLOW_OTEL_SPANS_TABLE",
        )
    }
    assert all(values.values()), f"Incomplete MLflow UC config in {env_file}: {values}"
    expected_catalog = os.environ.get(
        "MLFLOW_UC_CATALOG", DEFAULT_MLFLOW_UC_CATALOG
    )
    expected_schema = os.environ.get("MLFLOW_UC_SCHEMA", DEFAULT_MLFLOW_UC_SCHEMA)
    expected_prefix = os.environ.get(
        "MLFLOW_UC_TABLE_PREFIX", DEFAULT_MLFLOW_UC_TABLE_PREFIX
    )
    expected_spans_table = (
        f"{expected_catalog}.{expected_schema}.{expected_prefix}_otel_spans"
    )
    assert values["MLFLOW_UC_CATALOG"] == expected_catalog
    assert values["MLFLOW_UC_SCHEMA"] == expected_schema
    assert values["MLFLOW_UC_TABLE_PREFIX"] == expected_prefix
    assert values["MLFLOW_OTEL_SPANS_TABLE"] == expected_spans_table

    quickstart = _load_quickstart_module(workdir)
    trace_config = quickstart.MlflowTraceConfig(
        experiment_name=f"/Users/{WorkspaceClient(profile=profile).current_user.me().user_name}/agents-on-apps",
        experiment_id=values["MLFLOW_EXPERIMENT_ID"],
        warehouse_id=values["MLFLOW_TRACING_SQL_WAREHOUSE_ID"],
        catalog_name=values["MLFLOW_UC_CATALOG"],
        schema_name=values["MLFLOW_UC_SCHEMA"],
        table_prefix=values["MLFLOW_UC_TABLE_PREFIX"],
        otel_spans_table_name=values["MLFLOW_OTEL_SPANS_TABLE"],
    )
    workspace = WorkspaceClient(profile=profile)
    quickstart.grant_uc_trace_access_to_app(workspace, app_name, trace_config)

    invocation_request = {
        "input": [
            {
                "role": "user",
                "content": "What time is it? Use the get_current_time tool.",
            }
        ],
        "custom_inputs": {
            "Authorization": "Bearer request-secret",
            "api_key": "provider-secret",
            "request_label": "uc-smoke",
        },
    }
    response = requests.post(
        f"{app_url}/invocations",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-MLflow-Return-Trace-Id": "true",
        },
        json=invocation_request,
        timeout=120,
    )
    response.raise_for_status()
    try:
        invocation_response = response.json()
    except ValueError as error:
        raise AssertionError("Deployed invocation did not return JSON") from error
    trace_id = _trace_id_from_response(response)
    assert trace_id, (
        "Deployed invocation returned neither X-MLflow-Trace-Id nor response trace_id: "
        f"{response.text[:2000]}"
    )

    import mlflow
    from mlflow.entities.trace_location import UnityCatalog
    from mlflow.tracing.utils import parse_trace_id_v4

    tracking_uri = f"databricks://{profile}"
    os.environ["MLFLOW_TRACKING_URI"] = tracking_uri
    os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = trace_config.warehouse_id
    mlflow.set_tracking_uri(tracking_uri)

    experiment = mlflow.get_experiment(trace_config.experiment_id)
    expected_location = UnityCatalog(
        catalog_name=trace_config.catalog_name,
        schema_name=trace_config.schema_name,
        table_prefix=trace_config.table_prefix,
    )
    assert experiment is not None, (
        f"MLflow experiment {trace_config.experiment_id} does not exist"
    )
    assert experiment.trace_location == expected_location, (
        "Deployed experiment is not bound to the exact immutable UC location: "
        f"experiment={trace_config.experiment_id}, "
        f"actual={experiment.trace_location!r}, expected={expected_location!r}"
    )

    _, stored_trace_id = parse_trace_id_v4(trace_id)
    stored_trace_id = (stored_trace_id or trace_id).removeprefix("tr-").lower()
    trace_candidates = [trace_id.lower(), stored_trace_id, f"tr-{stored_trace_id}"]

    deadline = time.monotonic() + TRACE_PROPAGATION_TIMEOUT
    trace = None
    trace_rows = []
    last_error = None
    while time.monotonic() < deadline:
        try:
            trace = mlflow.get_trace(trace_id, flush=True)
            for candidate in trace_candidates:
                trace_rows = execute_trace_row_query(
                    workspace,
                    trace_config.warehouse_id,
                    trace_config.otel_spans_table_name,
                    candidate,
                )
                if trace_rows:
                    break
            if trace is not None and trace_rows:
                break
        except Exception as error:
            last_error = error
        time.sleep(10)

    assert trace is not None, f"MLflow could not retrieve trace {trace_id}: {last_error}"
    _assert_trace_contract(trace, invocation_request, invocation_response)
    normalized_trace = normalize_python_mlflow_trace(workdir.name, trace)
    assert_trace_contract(normalized_trace)
    assert trace_rows, (
        f"UC spans table {trace_config.otel_spans_table_name} has no rows for "
        f"trace {trace_id}; last error: {last_error}"
    )
    persisted_manifest = normalize_uc_rows(workdir.name, trace_rows)
    assert_trace_contract(persisted_manifest)

    host = workspace.config.host.rstrip("/")
    trace_link = (
        f"{host}/ml/experiments/{trace_config.experiment_id}/traces"
        f"?selectedTraceId={quote(trace_id, safe='')}"
    )
    table_link = (
        f"{host}/explore/data/{trace_config.catalog_name}/"
        f"{trace_config.schema_name}/{trace_config.otel_spans_table_name.rsplit('.', 1)[-1]}"
    )
    _log(f"[mlflow-uc-smoke] trace_id={trace_id} rows={len(trace_rows)}")
    _log(f"[mlflow-uc-smoke] MLflow trace: {trace_link}")
    _log(f"[mlflow-uc-smoke] UC spans table: {table_link}")
    return {"trace_id": trace_id, "trace_link": trace_link, "table_link": table_link}


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
def lakebase_autoscaling_endpoint(request):
    return request.config.getoption("--lakebase-autoscaling-endpoint")


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
    lakebase_autoscaling_endpoint,
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
        _run_lakebase_idempotent(tmp_path, profile, lakebase_autoscaling_endpoint, git_ref)
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
    workdir = _copy_template_for_quickstart(template_name, tmp_path, git_ref)

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
        app_url, token = wait_for_app_ready(app_name, profile)
        _verify_uc_trace_smoke(workdir, app_name, app_url, token, profile)
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

    workdir = _copy_template_for_quickstart(template_name, tmp_path, git_ref)
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
        app_url, token = wait_for_app_ready(app_name, profile)
        _verify_uc_trace_smoke(workdir, app_name, app_url, token, profile)
        _log("[existing-app] App reached RUNNING state")

    finally:
        if not no_destroy:
            bundle_destroy(workdir, profile)
            databricks_delete_app(app_name, profile)


def _run_lakebase_idempotent(
    tmp_path: Path,
    profile: str,
    lakebase_autoscaling_endpoint: str,
    git_ref: str | None,
):
    """Scenario C: Lakebase idempotency — re-running quickstart reuses existing config.

    Steps:
    1. Copy agent-langgraph-advanced via git ls-files
    2. First quickstart run: configures Lakebase, writes LAKEBASE_AUTOSCALING_ENDPOINT to .env
    3. Second quickstart run (no --lakebase flag): should reuse config from .env
    4. Assert same LAKEBASE_AUTOSCALING_ENDPOINT after both runs

    No deployment — this tests quickstart behavior only.
    """
    template_name = "agent-langgraph-advanced"
    app_name = _unique_app_name(template_name)
    workdir = _copy_template_for_quickstart(template_name, tmp_path, git_ref)

    _log(f"[lakebase-idempotent] workdir={workdir}, endpoint={lakebase_autoscaling_endpoint}")

    # First run: configure Lakebase
    _log("[lakebase-idempotent] Step 1: First quickstart run with --lakebase-autoscaling-endpoint")
    run_quickstart(
        workdir, profile,
        lakebase_autoscaling_endpoint=lakebase_autoscaling_endpoint,
        app_name=app_name,
    )

    env_file = workdir / ".env"
    assert env_file.exists(), ".env not created by quickstart"
    endpoint_1 = read_env_value(env_file, "LAKEBASE_AUTOSCALING_ENDPOINT")
    assert endpoint_1 == lakebase_autoscaling_endpoint, (
        f"LAKEBASE_AUTOSCALING_ENDPOINT not set correctly: "
        f"{endpoint_1!r} != {lakebase_autoscaling_endpoint!r}"
    )
    _log(f"[lakebase-idempotent] LAKEBASE_AUTOSCALING_ENDPOINT after first run: {endpoint_1}")

    # Second run: no lakebase flag — should reuse from .env
    _log("[lakebase-idempotent] Step 2: Second quickstart run (no --lakebase flag)")
    result = run_quickstart(workdir, profile)

    endpoint_2 = read_env_value(env_file, "LAKEBASE_AUTOSCALING_ENDPOINT")
    assert endpoint_2 == endpoint_1, (
        f"Idempotency failure: second run changed LAKEBASE_AUTOSCALING_ENDPOINT "
        f"{endpoint_2!r} != {endpoint_1!r}"
    )
    assert "Reusing existing Lakebase config" in result.stdout, (
        "Expected 'Reusing existing Lakebase config' in quickstart output"
    )
    _log("[lakebase-idempotent] Lakebase idempotency check passed")
