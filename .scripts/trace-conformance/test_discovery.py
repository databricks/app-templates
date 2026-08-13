import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from discovery import assert_template_policy, discover_agentic_templates


UC_ENV = """
env:
  - name: MLFLOW_EXPERIMENT_ID
  - name: MLFLOW_TRACING_SQL_WAREHOUSE_ID
  - name: MLFLOW_UC_CATALOG
  - name: MLFLOW_UC_SCHEMA
  - name: MLFLOW_UC_TABLE_PREFIX
  - name: MLFLOW_OTEL_SPANS_TABLE
"""


def _write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def _write_policy_evidence(template):
    _write(template / "app.yaml", UC_ENV)
    _write(
        template / "databricks.yml",
        """
resources:
  experiments:
    mlflow_experiment: {name: traced-agent}
  sql_warehouses:
    mlflow_tracing_warehouse: {id: warehouse}
""",
    )
    _write(
        template / "tests/test_trace_conformance.py",
        """
from trace_conformance import assert_trace_contract
from app import run_mocked_turn

def test_mocked_turn_trace_contract():
    manifest = run_mocked_turn(deterministic=True)
    assert_trace_contract(manifest)
""",
    )
    _write(
        template / "tests/deployed/test_trace_conformance.py",
        """
from trace_conformance import assert_trace_contract, normalize_uc_rows
from app import invoke_deployed_agent, get_trace, query_otel_spans

def test_deployed_trace_persists_to_uc():
    response = invoke_deployed_agent(prompt="Use the time tool")
    trace_id = response.trace_id
    get_trace(trace_id)
    rows = query_otel_spans(trace_id)
    assert_trace_contract(normalize_uc_rows("fixture", rows))
""",
    )


@pytest.fixture
def behavior_root(tmp_path):
    signals = {
        "agent-server": """
from databricks.agents import AgentServer
server = AgentServer(agent=planner)
""",
        "agent-constructor": """
from agents import Agent
planner = Agent(name="planner", instructions="help")
""",
        "agent-endpoint": """
result = client.responses.create(model="agents/catalog/schema/planner", input="hello")
""",
        "model-tool-loop": """
while tool_calls:
    response = model.invoke(messages)
    messages.append(tool.execute(response.tool_calls[0]))
""",
        "retrieval-generation": """
documents = retriever.invoke(question)
return model.generate([question, documents])
""",
    }
    for name, source in signals.items():
        _write(tmp_path / name / "src/app.py", source)
    _write(
        tmp_path / "non-agent" / "src/app.py",
        "def health():\n    return {'status': 'ok'}\n",
    )
    return tmp_path


def test_discovers_every_agentic_signal_and_ignores_non_agent(behavior_root):
    discovered = discover_agentic_templates(behavior_root)

    assert {template.name for template in discovered} == {
        "agent-server",
        "agent-constructor",
        "agent-endpoint",
        "model-tool-loop",
        "retrieval-generation",
    }
    assert {signal for template in discovered for signal in template.signals} == {
        "agent-server",
        "agent-constructor",
        "agent-endpoint",
        "model-tool-loop",
        "retrieval-generation",
    }


def test_complete_behavior_discovered_template_passes_policy(behavior_root):
    template = behavior_root / "agent-server"
    _write_policy_evidence(template)

    discovered = discover_agentic_templates(behavior_root)
    candidate = next(item for item in discovered if item.name == "agent-server")

    assert candidate.has_uc_resources is True
    assert candidate.has_local_conformance is True
    assert candidate.has_deployed_verification is True
    assert_template_policy([candidate])


def test_new_agentic_template_fails_until_all_three_proofs_exist(behavior_root):
    new_template = behavior_root / "new-agent"
    _write(
        new_template / "src/index.ts",
        "const supportAgent = new Agent({ name: 'support' });\n",
    )

    candidate = next(
        item
        for item in discover_agentic_templates(behavior_root)
        if item.name == "new-agent"
    )

    with pytest.raises(AssertionError) as error:
        assert_template_policy([candidate])

    message = str(error.value)
    assert "new-agent" in message
    assert "UC resources" in message
    assert "deterministic local conformance" in message
    assert "deployed verification" in message


@pytest.mark.parametrize(
    ("removed", "expected"),
    [
        ("uc", "UC resources"),
        ("local", "deterministic local conformance"),
        ("deployed", "deployed verification"),
    ],
)
def test_policy_reports_each_missing_behavioral_proof(tmp_path, removed, expected):
    template = tmp_path / "agent-template"
    _write(template / "src/app.py", "server = AgentServer(agent=planner)\n")
    _write_policy_evidence(template)
    if removed == "uc":
        (template / "app.yaml").unlink()
        (template / "databricks.yml").unlink()
    elif removed == "local":
        (template / "tests/test_trace_conformance.py").unlink()
    else:
        (template / "tests/deployed/test_trace_conformance.py").unlink()

    candidate = discover_agentic_templates(tmp_path)[0]
    with pytest.raises(AssertionError) as error:
        assert_template_policy([candidate])

    assert "agent-template" in str(error.value)
    assert expected in str(error.value)
