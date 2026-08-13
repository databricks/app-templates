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
)
from helpers import execute_trace_row_query, run_local_trace_test  # noqa: E402
from template_config import build_trace_policy_templates  # noqa: E402


def test_primary_template_policy_is_derived_from_behavior():
    discovered = [
        template
        for template in discover_agentic_templates(REPO_ROOT)
        if template.name.startswith("agent-")
    ]
    configured = build_trace_policy_templates()

    assert {template.name for template in configured} == {
        template.name for template in discovered if template.local_test_command
    }
    assert_template_policy(configured)


@pytest.mark.parametrize(
    "template",
    build_trace_policy_templates(),
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
