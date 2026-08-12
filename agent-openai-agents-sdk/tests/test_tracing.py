from __future__ import annotations

import asyncio
import hashlib
import json
from types import SimpleNamespace

import httpx
import mlflow
import pytest
from agents import set_default_openai_client
from openai import AsyncOpenAI
from mlflow.entities import SpanType
from mlflow.types.responses import ResponsesAgentRequest


def test_safe_capture_redacts_arbitrary_objects_and_bounded_streams():
    from agent_server import tracing

    class CredentialObject:
        def __repr__(self):
            return "CredentialObject(api_key='quoted-secret', token=unquoted-secret)"

    captured = tracing.safe_trace_value(
        {
            "authorization": "Bearer direct-secret",
            "object": CredentialObject(),
            "error": RuntimeError('password="exception-secret"'),
        }
    )
    assert captured == {
        "authorization": "[REDACTED]",
        "error": "RuntimeError('password=\"[REDACTED]\"')",
        "object": "CredentialObject(api_key='[REDACTED]', token=[REDACTED])",
    }

    accumulator = tracing.BoundedTraceAccumulator(max_bytes=32)
    values = ["abcdefghij", "klmnopqrst", "uvwxyz"]
    for value in values:
        accumulator.add(value)
    snapshot = accumulator.snapshot()
    canonical = json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode()
    assert snapshot == {
        "truncated": True,
        "originalBytes": len(canonical),
        "sha256": hashlib.sha256(canonical).hexdigest(),
        "preview": canonical[:32].decode(),
    }


def test_invoke_handler_sets_complete_request_identity_before_runner(
    monkeypatch, tmp_path
):
    tracking_uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    mlflow.set_tracking_uri(tracking_uri)
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    experiment_id = mlflow.create_experiment(
        "simple-tracing", artifact_location=artifact_dir.as_uri()
    )
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    monkeypatch.setenv("DATABRICKS_APP_NAME", "simple-agent-app")

    import databricks_openai

    test_client = AsyncOpenAI(api_key="test", base_url="https://example.invalid/v1")
    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: test_client)

    from agent_server import agent

    observed_metadata = {}
    original_update = mlflow.update_current_trace

    def observe_update(*, metadata=None, tags=None, client_request_id=None):
        observed_metadata.update(metadata or {})
        return original_update(
            metadata=metadata, tags=tags, client_request_id=client_request_id
        )

    monkeypatch.setattr(mlflow, "update_current_trace", observe_update)

    async def fake_run(_agent, _messages):
        return SimpleNamespace(new_items=[])

    monkeypatch.setattr(agent.Runner, "run", fake_run)
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "What time is it?"}],
        custom_inputs={
            "session_id": "session-123",
            "user_id": "user-456",
            "request_id": "request-789",
        },
    )

    with mlflow.start_span("request", span_type=SpanType.AGENT):
        asyncio.run(agent.invoke_handler(request))

    assert observed_metadata["mlflow.trace.session"] == "session-123"
    assert observed_metadata["mlflow.trace.user"] == "user-456"
    assert observed_metadata["appkit.request.id"] == "request-789"
    assert observed_metadata["appkit.app.name"] == "simple-agent-app"


def test_real_runner_tool_turn_has_one_root_and_one_model_span_per_call(
    monkeypatch, tmp_path
):
    tracking_uri = f"sqlite:///{tmp_path / 'runtime.db'}"
    mlflow.set_tracking_uri(tracking_uri)
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    experiment_id = mlflow.create_experiment(
        "simple-runtime", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    responses = [
        {
            "id": "chatcmpl-tool",
            "object": "chat.completion",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call-time",
                                "type": "function",
                                "function": {
                                    "name": "get_current_time",
                                    "arguments": "{}",
                                },
                            }
                        ],
                    },
                }
            ],
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 3,
                "total_tokens": 14,
                "prompt_tokens_details": {"cached_tokens": 2},
            },
        },
        {
            "id": "chatcmpl-final",
            "object": "chat.completion",
            "created": 2,
            "model": "databricks-gpt-5-2",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": "It is traced."},
                }
            ],
            "usage": {
                "prompt_tokens": 17,
                "completion_tokens": 4,
                "total_tokens": 21,
            },
        },
    ]

    async def transport(request):
        assert request.url.path.endswith("/chat/completions")
        return httpx.Response(200, json=responses.pop(0), request=request)

    client = AsyncOpenAI(
        api_key="test",
        base_url="https://example.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    import databricks_openai

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: client)
    set_default_openai_client(client)

    from agent_server import agent

    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "What time is it?"}],
        custom_inputs={
            "session_id": "session-tool",
            "user_id": "user-tool",
            "request_id": "request-tool",
        },
    )
    response = asyncio.run(agent.invoke_handler(request))
    assert response.output[-1].content[0]["text"] == "It is traced."

    mlflow.flush_trace_async_logging()
    trace_rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(trace_rows) == 1
    trace = mlflow.get_trace(trace_rows.iloc[0].trace_id)
    roots = [span for span in trace.data.spans if span.parent_id is None]
    model_spans = [
        span for span in trace.data.spans if span.span_type in {"CHAT_MODEL", "LLM"}
    ]
    tool_spans = [span for span in trace.data.spans if span.span_type == "TOOL"]
    assert [(span.name, span.span_type) for span in roots] == [
        ("AgentRunner.run", "AGENT")
    ]
    assert len(model_spans) == 2
    assert len(tool_spans) == 1
    root_usage = roots[0].get_attribute("appkit.usage")
    assert root_usage == {
        "inputTokens": 28,
        "outputTokens": 7,
        "totalTokens": 35,
        "cacheReadInputTokens": 2,
        "costAvailable": False,
    }


def test_model_failure_finalizes_root_and_model_with_safe_error(monkeypatch, tmp_path):
    tracking_uri = f"sqlite:///{tmp_path / 'failure.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "simple-failure", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    async def transport(request):
        return httpx.Response(
            500,
            json={"error": {"message": "token=provider-secret", "type": "server"}},
            request=request,
        )

    client = AsyncOpenAI(
        api_key="test",
        base_url="https://example.invalid/v1",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    import databricks_openai

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: client)
    set_default_openai_client(client)
    from agent_server import agent

    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "authorization='request-secret'"}],
        custom_inputs={"session_id": "failure", "request_id": "failure"},
    )
    with pytest.raises(Exception):
        asyncio.run(agent.invoke_handler(request))

    mlflow.flush_trace_async_logging()
    trace_rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(trace_rows) == 1
    trace = mlflow.get_trace(trace_rows.iloc[0].trace_id)
    root = next(span for span in trace.data.spans if span.parent_id is None)
    model = next(span for span in trace.data.spans if span.span_type == "CHAT_MODEL")
    assert root.status.status_code == "ERROR"
    assert model.status.status_code == "ERROR"
    assert root.get_attribute("appkit.usage") == {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "costAvailable": False,
    }
    assert model.get_attribute("appkit.model") == "databricks-gpt-5-2"
    assert model.get_attribute("appkit.provider") == "databricks"
    assert model.get_attribute("appkit.finish_reason") == "error"
    serialized = json.dumps([span.to_dict() for span in trace.data.spans])
    assert "provider-secret" not in serialized
    assert "request-secret" not in serialized
    assert "[REDACTED]" in serialized


def test_real_stream_runner_finalizes_one_root_with_usage(monkeypatch, tmp_path):
    tracking_uri = f"sqlite:///{tmp_path / 'stream.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "simple-stream", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    chunks = [
        {
            "id": "chatcmpl-stream",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": None,
                    "delta": {"role": "assistant", "content": "S" * 40_000},
                }
            ],
        },
        {
            "id": "chatcmpl-stream",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [
                {"index": 0, "finish_reason": "stop", "delta": {}}
            ],
        },
        {
            "id": "chatcmpl-stream",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [],
            "usage": {
                "prompt_tokens": 5,
                "completion_tokens": 2,
                "total_tokens": 7,
            },
        },
    ]
    body = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
    body += "data: [DONE]\n\n"

    async def transport(request):
        return httpx.Response(
            200,
            content=body.encode(),
            headers={"content-type": "text/event-stream"},
            request=request,
        )

    client = AsyncOpenAI(
        api_key="test",
        base_url="https://example.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    import databricks_openai

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: client)
    set_default_openai_client(client)
    from agent_server import agent

    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "stream this"}],
        custom_inputs={
            "session_id": "stream-session",
            "user_id": "stream-user",
            "request_id": "stream-request",
        },
    )

    async def collect():
        return [event async for event in agent.stream_handler(request)]

    events = asyncio.run(collect())
    assert events
    mlflow.flush_trace_async_logging()
    rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(rows) == 1
    trace = mlflow.get_trace(rows.iloc[0].trace_id)
    roots = [span for span in trace.data.spans if span.parent_id is None]
    model_spans = [span for span in trace.data.spans if span.span_type == "CHAT_MODEL"]
    assert [(span.name, span.span_type) for span in roots] == [
        ("AgentRunner.run_streamed", "AGENT")
    ]
    assert len(model_spans) == 1
    assert roots[0].get_attribute("appkit.usage") == {
        "inputTokens": 5,
        "outputTokens": 2,
        "totalTokens": 7,
        "costAvailable": False,
    }
    stream_capture = roots[0].get_attribute("appkit.stream.capture")
    assert stream_capture["truncated"] is True
    assert stream_capture["originalBytes"] > 32 * 1024
    assert len(stream_capture["sha256"]) == 64
