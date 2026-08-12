from __future__ import annotations

import asyncio
import importlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import databricks.sdk
import mlflow
from mlflow.genai.agent_server import server
import pytest


REQUIRED_TRACING_ENV = {
    "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "warehouse-test",
    "MLFLOW_UC_CATALOG": "catalog_test",
    "MLFLOW_UC_SCHEMA": "schema_test",
    "MLFLOW_UC_TABLE_PREFIX": "batch_test",
    "MLFLOW_OTEL_SPANS_TABLE": "catalog_test.schema_test.batch_test_otel_spans",
}


class FakeCompletion:
    def __init__(
        self,
        *,
        content: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float | None,
    ) -> None:
        usage = {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        }
        if cost_usd is not None:
            usage["cost_usd"] = cost_usd
        self.model = "databricks-gpt-5-2"
        self.usage = usage
        self.choices = [
            SimpleNamespace(
                message=SimpleNamespace(content=content), finish_reason="stop"
            )
        ]

    def model_dump(self) -> dict:
        return {
            "model": self.model,
            "choices": [
                {
                    "message": {"content": self.choices[0].message.content},
                    "finish_reason": self.choices[0].finish_reason,
                }
            ],
            "usage": dict(self.usage),
        }


class FakeCompletions:
    def __init__(self, responses: list[FakeCompletion]) -> None:
        self._responses = iter(responses)

    def create(self, **_kwargs) -> FakeCompletion:
        return next(self._responses)


class FakeWorkspaceClient:
    def __init__(self, responses: list[FakeCompletion]) -> None:
        self._client = SimpleNamespace(
            chat=SimpleNamespace(completions=FakeCompletions(responses))
        )
        self.serving_endpoints = SimpleNamespace(
            get_open_ai_client=self.get_open_ai_client
        )

    def get_open_ai_client(self):
        return self._client


def test_malformed_second_answer_preserves_batch_trace_and_usage(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    tracking_uri = f"sqlite:///{tmp_path / 'tracking.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "batch-partial-parser", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    for name, value in REQUIRED_TRACING_ENV.items():
        monkeypatch.setenv(name, value)

    responses = [
        FakeCompletion(
            content='{"answer":"Yes","reasoning":"Found it."}',
            input_tokens=10,
            output_tokens=2,
            cost_usd=0.01,
        ),
        FakeCompletion(
            content="malformed structured response",
            input_tokens=20,
            output_tokens=3,
            cost_usd=None,
        ),
        FakeCompletion(
            content='{"answer":"No","reasoning":"Not present."}',
            input_tokens=30,
            output_tokens=4,
            cost_usd=0.03,
        ),
    ]
    workspace = FakeWorkspaceClient(responses)
    monkeypatch.setattr(databricks.sdk, "WorkspaceClient", lambda: workspace)
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    monkeypatch.setattr(server, "_invoke_function", None)

    agent = importlib.import_module("agent_server.agent")
    result = asyncio.run(
        agent.invoke_handler(
            {
                "document_text": "api_key=doc-secret. The document has a balance sheet.",
                "questions": ["Balance sheet?", "Income statement?", "Audit report?"],
                "session_id": "batch-session",
                "user_id": "batch-user",
                "request_id": "batch-request",
            }
        )
    )

    assert [item["answer"] for item in result["results"]] == ["Yes", "No", "No"]
    traces = mlflow.search_traces(
        locations=[experiment_id], return_type="list", flush=True
    )
    assert len(traces) == 1
    trace = mlflow.get_trace(traces[0].info.trace_id, flush=True)
    roots = [span for span in trace.data.spans if span.parent_id is None]
    assert [(span.span_type, span.status.status_code) for span in roots] == [
        ("AGENT", "ERROR")
    ]
    root = roots[0]
    models = sorted(
        (span for span in trace.data.spans if span.span_type == "CHAT_MODEL"),
        key=lambda span: span.get_attribute("appkit.question_index"),
    )
    parsers = sorted(
        (span for span in trace.data.spans if span.span_type == "PARSER"),
        key=lambda span: span.get_attribute("appkit.question_index"),
    )
    assert len(models) == 3
    assert all(span.end_time_ns is not None for span in models)
    assert [span.status.status_code for span in models] == ["OK", "OK", "OK"]
    assert [span.status.status_code for span in parsers] == ["OK", "ERROR", "OK"]
    assert models[0].get_attribute("appkit.usage") == {
        "inputTokens": 10,
        "outputTokens": 2,
        "totalTokens": 12,
        "costAvailable": True,
        "costUsd": 0.01,
    }
    assert models[1].get_attribute("appkit.usage") == {
        "inputTokens": 20,
        "outputTokens": 3,
        "totalTokens": 23,
        "costAvailable": False,
    }
    assert models[2].get_attribute("appkit.usage") == {
        "inputTokens": 30,
        "outputTokens": 4,
        "totalTokens": 34,
        "costAvailable": True,
        "costUsd": 0.03,
    }
    assert [span.get_attribute("appkit.cost_available") for span in models] == [
        True,
        False,
        True,
    ]
    assert models[0].get_attribute("appkit.cost_usd") == 0.01
    assert "appkit.cost_usd" not in models[1].attributes
    assert models[2].get_attribute("appkit.cost_usd") == 0.03
    assert root.get_attribute("appkit.usage") == {
        "inputTokens": 60,
        "outputTokens": 9,
        "totalTokens": 69,
        "costAvailable": False,
    }
    assert root.get_attribute("appkit.cost_available") is False
    assert "appkit.cost_usd" not in root.attributes
    assert [item["question_text"] for item in root.outputs["partialOutputs"]] == [
        "Balance sheet?"
    ]
    assert root.outputs["results"] == result["results"]
    assert all(span.get_attribute("appkit.duration_ms") >= 0 for span in models + parsers)
    assert trace.info.trace_metadata["mlflow.trace.session"] == "batch-session"
    assert trace.info.trace_metadata["mlflow.trace.user"] == "batch-user"
    assert trace.info.trace_metadata["appkit.request.id"] == "batch-request"
    assert trace.info.tags["template"] == "agent-non-conversational"
    exported = json.dumps([span.to_dict() for span in trace.data.spans], sort_keys=True)
    assert "doc-secret" not in exported
    assert "[REDACTED]" in exported


def test_agent_import_reports_every_missing_tracing_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    required_names = (
        "MLFLOW_TRACKING_URI",
        "MLFLOW_EXPERIMENT_ID",
        *REQUIRED_TRACING_ENV,
    )
    for name in required_names:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(
        databricks.sdk,
        "WorkspaceClient",
        lambda: FakeWorkspaceClient([]),
    )
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    monkeypatch.setattr(server, "_invoke_function", None)

    with pytest.raises(RuntimeError) as caught:
        importlib.import_module("agent_server.agent")

    for name in required_names:
        assert name in str(caught.value)


def test_runtime_trace_export_failure_does_not_fail_successful_response(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    tracking_uri = f"sqlite:///{tmp_path / 'export-failure.db'}"
    artifact_dir = tmp_path / "export-failure-artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "batch-export-failure", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    for name, value in REQUIRED_TRACING_ENV.items():
        monkeypatch.setenv(name, value)
    workspace = FakeWorkspaceClient(
        [
            FakeCompletion(
                content='{"answer":"Yes","reasoning":"Present."}',
                input_tokens=4,
                output_tokens=2,
                cost_usd=None,
            )
        ]
    )
    monkeypatch.setattr(databricks.sdk, "WorkspaceClient", lambda: workspace)
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    monkeypatch.setattr(server, "_invoke_function", None)
    agent = importlib.import_module("agent_server.agent")

    def fail_export(**_kwargs):
        raise RuntimeError("trace exporter unavailable")

    monkeypatch.setattr(mlflow, "start_span", fail_export)

    result = asyncio.run(
        agent.invoke_handler(
            {"document_text": "Balance sheet.", "questions": ["Present?"]}
        )
    )

    assert result["results"][0]["answer"] == "Yes"


def test_model_failure_finalizes_safe_error_and_known_usage(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    tracking_uri = f"sqlite:///{tmp_path / 'model-failure.db'}"
    artifact_dir = tmp_path / "model-failure-artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "batch-model-failure", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    for name, value in REQUIRED_TRACING_ENV.items():
        monkeypatch.setenv(name, value)

    class FailingCompletions:
        def create(self, **_kwargs):
            raise RuntimeError("token model-secret")

    workspace = SimpleNamespace(
        serving_endpoints=SimpleNamespace(
            get_open_ai_client=lambda: SimpleNamespace(
                chat=SimpleNamespace(completions=FailingCompletions())
            )
        )
    )
    monkeypatch.setattr(databricks.sdk, "WorkspaceClient", lambda: workspace)
    sys.modules.pop("agent_server.agent", None)
    sys.modules.pop("agent_server.tracing", None)
    monkeypatch.setattr(server, "_invoke_function", None)
    agent = importlib.import_module("agent_server.agent")

    with pytest.raises(RuntimeError, match="model-secret"):
        asyncio.run(
            agent.invoke_handler(
                {"document_text": "Balance sheet.", "questions": ["Present?"]}
            )
        )

    traces = mlflow.search_traces(
        locations=[experiment_id], return_type="list", flush=True
    )
    trace = mlflow.get_trace(traces[0].info.trace_id, flush=True)
    root = next(span for span in trace.data.spans if span.parent_id is None)
    model = next(
        span for span in trace.data.spans if span.span_type == "CHAT_MODEL"
    )
    assert root.status.status_code == "ERROR"
    assert model.status.status_code == "ERROR"
    assert model.end_time_ns is not None
    expected_usage = {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "costAvailable": False,
    }
    assert model.get_attribute("appkit.usage") == expected_usage
    assert root.get_attribute("appkit.usage") == expected_usage
    assert root.get_attribute("appkit.duration_ms") >= 0
    assert model.get_attribute("appkit.duration_ms") >= 0
    exported = json.dumps([span.to_dict() for span in trace.data.spans], sort_keys=True)
    assert "model-secret" not in exported
    assert "token [REDACTED]" in exported
