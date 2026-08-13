import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

INTEGRATION_DIR = Path(__file__).parent
REPO_ROOT = INTEGRATION_DIR.parents[1]
CONFORMANCE_DIR = REPO_ROOT / ".scripts" / "trace-conformance"
sys.path.insert(0, str(CONFORMANCE_DIR))

from contract import assert_trace_contract  # noqa: E402
from discovery import (  # noqa: E402
    assert_template_policy,
    discover_agentic_templates,
    is_trace_policy_candidate,
)
from helpers import (  # noqa: E402
    _run_typescript_trace_probe,
    execute_trace_row_query,
    run_local_trace_test,
)
from normalize import load_trace_manifest  # noqa: E402
from template_config import (  # noqa: E402
    TemplateConfig,
    build_templates,
    build_trace_policy_templates,
)


DEPLOYED_TEMPLATE_NAMES = {template.name for template in build_templates()}
TRACE_POLICY_TEMPLATES = build_trace_policy_templates(
    deployed_template_names=DEPLOYED_TEMPLATE_NAMES,
)
RUNNABLE_TRACE_POLICY_TEMPLATES = [
    template
    for template in TRACE_POLICY_TEMPLATES
    if template.local_test_command is not None
]


def test_primary_template_policy_is_derived_from_behavior():
    discovered = [
        template
        for template in discover_agentic_templates(REPO_ROOT)
        if is_trace_policy_candidate(template)
    ]

    assert {template.name for template in TRACE_POLICY_TEMPLATES} == {
        template.name for template in discovered
    }
    assert_template_policy(TRACE_POLICY_TEMPLATES)


@pytest.mark.parametrize(
    "template",
    RUNNABLE_TRACE_POLICY_TEMPLATES,
    ids=lambda template: template.name,
)
def test_deterministic_template_turn_writes_a_conformant_manifest(template, tmp_path):
    manifest_path = tmp_path / f"{template.name}.json"

    manifest = run_local_trace_test(template, manifest_path)

    assert manifest_path.exists()
    assert manifest.template == template.name
    assert_trace_contract(manifest)


class _StatementExecution:
    def __init__(self):
        self.calls = []

    def execute_statement(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            status=SimpleNamespace(state=SimpleNamespace(value="SUCCEEDED")),
            result=SimpleNamespace(
                data_array=[
                    [
                        "trace-id",
                        "span-id",
                        None,
                        "request",
                        '{"mlflow.spanType":"AGENT"}',
                    ]
                ]
            ),
        )


def test_deployed_uc_query_is_parameterized_by_table_and_trace_id():
    execution = _StatementExecution()
    workspace = SimpleNamespace(statement_execution=execution)

    rows = execute_trace_row_query(
        workspace,
        "0123456789abcdef",
        "main.agent_traces.agents_on_apps_otel_spans",
        "trace-id",
    )

    assert rows == [
        {
            "trace_id": "trace-id",
            "span_id": "span-id",
            "parent_span_id": None,
            "name": "request",
            "attributes": '{"mlflow.spanType":"AGENT"}',
        }
    ]
    assert len(execution.calls) == 1
    call = execution.calls[0]
    assert call["statement"] == (
        "SELECT trace_id, span_id, parent_span_id, name, attributes\n"
        "FROM IDENTIFIER(:otel_spans_table)\n"
        "WHERE trace_id = :trace_id\n"
        "ORDER BY start_time_unix_nano"
    )
    assert call["warehouse_id"] == "0123456789abcdef"
    assert [parameter.as_dict() for parameter in call["parameters"]] == [
        {
            "name": "otel_spans_table",
            "type": "STRING",
            "value": "main.agent_traces.agents_on_apps_otel_spans",
        },
        {"name": "trace_id", "type": "STRING", "value": "trace-id"},
    ]
    assert call["wait_timeout"] == "50s"


def test_deploy_runner_verifies_uc_trace_for_each_parameterized_template(
    monkeypatch,
    tmp_path,
):
    import test_e2e as e2e
    import test_quickstart_e2e as quickstart_e2e

    template = TemplateConfig(
        name="support-agent",
        dev_app_name="dev-support-agent",
        app_resource_key="support_agent",
    )
    monkeypatch.setattr(e2e, "bundle_deploy", lambda *args: None)
    monkeypatch.setattr(e2e, "bundle_run_nowait", lambda *args: None)
    monkeypatch.setattr(
        e2e,
        "wait_for_app_ready",
        lambda *args: ("https://support-agent.example", "token"),
    )
    monkeypatch.setattr(e2e, "_query_endpoints", lambda *args: None)
    observed = []
    monkeypatch.setattr(
        quickstart_e2e,
        "_verify_uc_trace_smoke",
        lambda *args: observed.append(args),
    )

    e2e._run_deploy(
        template,
        tmp_path,
        "dev",
        tmp_path / "deploy.log",
        no_destroy=True,
    )

    assert observed == [
        (
            tmp_path,
            "dev-support-agent",
            "https://support-agent.example",
            "token",
            "dev",
        )
    ]


def test_independent_typescript_captures_use_sdk_generated_trace_identity(tmp_path):
    template_dir = REPO_ROOT / "agent-langchain-ts"
    first_path = tmp_path / "first.json"
    second_path = tmp_path / "second.json"

    _run_typescript_trace_probe(template_dir, first_path, CONFORMANCE_DIR)
    _run_typescript_trace_probe(template_dir, second_path, CONFORMANCE_DIR)

    first = load_trace_manifest(first_path)
    second = load_trace_manifest(second_path)
    assert first.trace_id != second.trace_id
