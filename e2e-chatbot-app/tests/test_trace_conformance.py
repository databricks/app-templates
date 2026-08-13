from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from contract import assert_trace_contract  # noqa: E402
from normalize import write_trace_manifest  # noqa: E402
import model_serving_utils  # noqa: E402
from trace_verification import retrieve_remote_trace, verify_remote_trace  # noqa: E402


def _create_provider_trace(mlflow):
    usage = {"inputTokens": 2, "outputTokens": 1, "totalTokens": 3}
    with mlflow.start_span(name="remote.agent", span_type="AGENT") as root:
        root.set_inputs({"input": "Use the deterministic tool"})
        root.set_attributes(
            {
                "appkit.usage": {**usage, "costAvailable": False},
                "appkit.cost_available": False,
            }
        )
        mlflow.update_current_trace(
            metadata={
                "appkit.app.name": "remote-agent",
                "mlflow.trace.user": "local-user",
                "mlflow.trace.session": "local-session",
            }
        )
        with mlflow.start_span(name="remote.model", span_type="CHAT_MODEL") as model:
            model.set_inputs({"messages": ["Use the deterministic tool"]})
            model.set_outputs({"text": "done"})
            model.set_attributes(
                {
                    "appkit.model": "test-model",
                    "appkit.provider": "databricks",
                    "appkit.usage": {**usage, "costAvailable": False},
                    "appkit.cost_available": False,
                }
            )
            model.set_status("OK")
        root.set_outputs({"output": "done"})
        root.set_status("OK")
        return root.trace_id


def test_deterministic_remote_agent_response_is_bound_to_conformant_mlflow_and_uc(
    monkeypatch,
    tmp_path,
):
    import mlflow

    previous_tracking_uri = mlflow.get_tracking_uri()
    monkeypatch.setenv("MLFLOW_ALLOW_FILE_STORE", "true")
    mlflow.set_tracking_uri(tmp_path.as_uri())
    mlflow.set_experiment("legacy-chatbot-local-conformance")
    trace_id = _create_provider_trace(mlflow)
    stale_trace_id = _create_provider_trace(mlflow)
    assert stale_trace_id != trace_id
    monkeypatch.setattr(
        model_serving_utils,
        "_get_endpoint_task_type",
        lambda _endpoint: "agent/v1/responses",
    )
    monkeypatch.setattr(
        model_serving_utils,
        "get_deploy_client",
        lambda _uri: type(
            "Client",
            (),
            {
                "predict": lambda _self, **_kwargs: {
                    "output": [
                        {
                            "type": "message",
                            "content": [{"type": "output_text", "text": "done"}],
                        }
                    ],
                    "databricks_output": {"databricks_request_id": trace_id},
                }
            },
        )(),
    )

    try:
        messages, request_id = model_serving_utils.query_endpoint(
            "remote-agent", [{"role": "user", "content": "hello"}], True
        )
        assert messages[0]["content"] == "done"
        mlflow_manifest = retrieve_remote_trace(request_id)
        assert_trace_contract(mlflow_manifest)
        if destination := os.environ.get("TRACE_CONFORMANCE_MANIFEST"):
            write_trace_manifest(destination, mlflow_manifest)
    finally:
        mlflow.set_tracking_uri(previous_tracking_uri)


def test_deployed_remote_agent_trace_persists_to_uc():
    required = {
        name: os.environ.get(name)
        for name in (
            "SERVING_ENDPOINT",
            "MLFLOW_EXPERIMENT_ID",
            "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
            "MLFLOW_OTEL_SPANS_TABLE",
        )
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        pytest.skip(
            "deployed remote trace credentials are absent: " + ", ".join(missing)
        )

    integration = Path(__file__).parents[2] / ".scripts" / "agent-integration-tests"
    sys.path.insert(0, str(integration))
    from helpers import execute_trace_row_query
    from normalize import normalize_uc_rows

    import mlflow
    from databricks.sdk import WorkspaceClient

    profile = os.environ.get("DATABRICKS_CONFIG_PROFILE")
    mlflow.set_tracking_uri(f"databricks://{profile}" if profile else "databricks")
    experiment = mlflow.MlflowClient().get_experiment(required["MLFLOW_EXPERIMENT_ID"])
    assert (
        experiment.trace_location.full_otel_spans_table_name
        == required["MLFLOW_OTEL_SPANS_TABLE"]
    )
    _messages, trace_id = model_serving_utils.query_endpoint(
        required["SERVING_ENDPOINT"],
        [{"role": "user", "content": "Use the deterministic tool"}],
        True,
    )
    mlflow_manifest = retrieve_remote_trace(trace_id)
    workspace = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    rows = execute_trace_row_query(
        workspace,
        required["MLFLOW_TRACING_SQL_WAREHOUSE_ID"],
        required["MLFLOW_OTEL_SPANS_TABLE"],
        trace_id,
    )
    uc_manifest = normalize_uc_rows("e2e-chatbot-app", rows)
    verify_remote_trace(trace_id, mlflow_manifest, uc_manifest)
