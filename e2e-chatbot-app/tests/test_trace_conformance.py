from __future__ import annotations

from copy import deepcopy
import os
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from contract import SpanManifest, TraceManifest, assert_trace_contract  # noqa: E402
from normalize import write_trace_manifest  # noqa: E402
import model_serving_utils  # noqa: E402
from trace_verification import verify_remote_trace  # noqa: E402


def _manifest(trace_id: str) -> TraceManifest:
    usage = {"input_tokens": 2, "output_tokens": 1, "total_tokens": 3}
    return TraceManifest(
        template="e2e-chatbot-app",
        trace_id=trace_id,
        spans=[
            SpanManifest(
                name="remote.agent",
                span_type="AGENT",
                span_id="root-span",
                parent_span_id=None,
                inputs={"input": "Use the deterministic tool"},
                outputs={"output": "done"},
                status="OK",
                latency_ms=2.0,
                model=None,
                provider=None,
                usage=usage,
                cost_usd=None,
                cost_available=False,
                links=[],
                attributes={
                    "app_id": "remote-agent",
                    "user_id": "local-user",
                    "session_id": "local-session",
                },
            ),
            SpanManifest(
                name="remote.model",
                span_type="CHAT_MODEL",
                span_id="model-span",
                parent_span_id="root-span",
                inputs={"messages": ["Use the deterministic tool"]},
                outputs={"text": "done"},
                status="OK",
                latency_ms=1.0,
                model="test-model",
                provider="databricks",
                usage=usage,
                cost_usd=None,
                cost_available=False,
                links=[],
                attributes={},
            ),
        ],
    )


def test_deterministic_remote_agent_response_is_bound_to_conformant_mlflow_and_uc(
    monkeypatch,
):
    trace_id = "trace-deterministic"
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

    messages, request_id = model_serving_utils.query_endpoint(
        "remote-agent", [{"role": "user", "content": "hello"}], True
    )
    assert messages[0]["content"] == "done"
    mlflow_manifest = _manifest(trace_id)
    uc_manifest = deepcopy(mlflow_manifest)
    assert_trace_contract(mlflow_manifest)
    verify_remote_trace(request_id, mlflow_manifest, uc_manifest)
    if destination := os.environ.get("TRACE_CONFORMANCE_MANIFEST"):
        write_trace_manifest(destination, mlflow_manifest)


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
    from normalize import normalize_python_mlflow_trace, normalize_uc_rows

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
    mlflow_trace = mlflow.get_trace(trace_id)
    mlflow_manifest = normalize_python_mlflow_trace("e2e-chatbot-app", mlflow_trace)
    workspace = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
    rows = execute_trace_row_query(
        workspace,
        required["MLFLOW_TRACING_SQL_WAREHOUSE_ID"],
        required["MLFLOW_OTEL_SPANS_TABLE"],
        trace_id,
    )
    uc_manifest = normalize_uc_rows("e2e-chatbot-app", rows)
    verify_remote_trace(trace_id, mlflow_manifest, uc_manifest)
