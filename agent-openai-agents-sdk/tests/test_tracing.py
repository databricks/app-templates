from __future__ import annotations

import asyncio
import gc
import hashlib
import json
import os
import weakref
from types import SimpleNamespace

import httpx

os.environ.setdefault("MLFLOW_DISABLE_TELEMETRY", "true")

import mlflow
import pytest
from agents import set_default_openai_client
from openai import AsyncOpenAI
from mlflow.entities import SpanType
from mlflow.types.responses import ResponsesAgentRequest


@pytest.mark.parametrize(
    "label",
    [
        "authorization",
        "api-key",
        "api_key",
        "cookie",
        "credential",
        "password",
        "secret",
        "token",
    ],
)
def test_safe_capture_redacts_every_credential_text_form(label):
    from agent_server import tracing

    class ArbitraryValue:
        def __repr__(self):
            return "ArbitraryValue(token reprvalue, secret='reprquoted')"

    values = [
        f"before {label} whitespacevalue after",
        f"before {label}='quotedvalue' after",
        f"before {label}=unquotedvalue after",
        f"before {label} Bearer bearervalue after",
        RuntimeError("authorization Bearer exceptionvalue"),
        ArbitraryValue(),
    ]
    captured = tracing.safe_trace_value(values)
    serialized = json.dumps(captured)

    for secret in (
        "whitespacevalue",
        "quotedvalue",
        "unquotedvalue",
        "bearervalue",
        "exceptionvalue",
        "reprvalue",
        "reprquoted",
    ):
        assert secret not in serialized
    for item in captured[:4]:
        assert item.startswith("before ")
        assert item.endswith(" after")
        assert "[REDACTED]" in item


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
                "cost_usd": 0.02,
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
                "cost_usd": 0.01,
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
    from agents.tracing.setup import get_trace_provider
    from mlflow.openai._agent_tracer import MlflowOpenAgentTracingProcessor

    processors = get_trace_provider()._multi_processor._processors
    assert len(processors) == 1
    assert isinstance(processors[0], MlflowOpenAgentTracingProcessor)

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
    model_spans = sorted(
        [
            span
            for span in trace.data.spans
            if span.span_type in {"CHAT_MODEL", "LLM"}
        ],
        key=lambda span: span.start_time_ns,
    )
    tool_spans = [span for span in trace.data.spans if span.span_type == "TOOL"]
    workflow = next(span for span in trace.data.spans if span.name == "Agent workflow")
    assert workflow.inputs["data"]["sdk_span_type"] == "task"
    assert workflow.inputs["data"]["name"] == workflow.name
    assert [(span.name, span.span_type) for span in roots] == [
        ("AgentRunner.run", "AGENT")
    ]
    assert roots[0].status.status_code == "OK"
    assert len(model_spans) == 2
    assert len(tool_spans) == 1
    assert all(span.parent_id is not None for span in model_spans + tool_spans)
    assert all(span.trace_id == roots[0].trace_id for span in model_spans + tool_spans)
    assert [span.status.status_code for span in model_spans] == ["OK", "OK"]
    assert [span.get_attribute("appkit.model") for span in model_spans] == [
        "databricks-gpt-5-2",
        "databricks-gpt-5-2",
    ]
    assert [span.get_attribute("appkit.provider") for span in model_spans] == [
        "databricks",
        "databricks",
    ]
    assert [span.get_attribute("appkit.finish_reason") for span in model_spans] == [
        "tool_calls",
        "stop",
    ]
    assert [span.get_attribute("appkit.error") for span in model_spans] == [None, None]
    assert [span.get_attribute("appkit.cost_available") for span in model_spans] == [
        True,
        True,
    ]
    assert [span.get_attribute("appkit.cost_usd") for span in model_spans] == [
        0.02,
        0.01,
    ]
    assert [span.get_attribute("mlflow.llm.cost") for span in model_spans] == [
        {"total_cost": 0.02},
        {"total_cost": 0.01},
    ]
    assert [span.get_attribute("appkit.usage") for span in model_spans] == [
        {
            "inputTokens": 11,
            "outputTokens": 3,
            "totalTokens": 14,
            "cacheReadInputTokens": 2,
            "costAvailable": True,
            "costUsd": 0.02,
        },
        {
            "inputTokens": 17,
            "outputTokens": 4,
            "totalTokens": 21,
            "costAvailable": True,
            "costUsd": 0.01,
        },
    ]
    assert all(span.get_attribute("appkit.ttft_ms") >= 0 for span in model_spans)
    assert all(
        span.get_attribute("appkit.stream_duration_ms") >= 0
        for span in model_spans
    )
    root_usage = roots[0].get_attribute("appkit.usage")
    assert root_usage == {
        "inputTokens": 28,
        "outputTokens": 7,
        "totalTokens": 35,
        "cacheReadInputTokens": 2,
        "costAvailable": True,
        "costUsd": 0.03,
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
    roots = [span for span in trace.data.spans if span.parent_id is None]
    models = [span for span in trace.data.spans if span.span_type == "CHAT_MODEL"]
    assert len(roots) == 1
    assert len(models) == 1
    root = roots[0]
    model = models[0]
    assert root.status.status_code == "ERROR"
    assert model.status.status_code == "ERROR"
    assert root.outputs["partial_output"] == {"model_calls_completed": 1}
    assert model.outputs["partial_output"] == {"events": []}
    assert root.get_attribute("appkit.usage") == {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "costAvailable": False,
    }
    assert model.get_attribute("appkit.model") == "databricks-gpt-5-2"
    assert model.get_attribute("appkit.provider") == "databricks"
    assert model.get_attribute("appkit.finish_reason") == "error"
    assert "[REDACTED]" in model.get_attribute("appkit.error")
    assert model.get_attribute("appkit.usage") == {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "costAvailable": False,
    }
    assert model.get_attribute("appkit.cost_available") is False
    assert "appkit.cost_usd" not in model.attributes
    assert model.get_attribute("appkit.ttft_ms") >= 0
    assert model.get_attribute("appkit.stream_duration_ms") >= 0
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

    from agent_server import tracing

    async def collect():
        first = [event async for event in agent.stream_handler(request)]
        assert tracing._stream_capture.get() is None
        second = [event async for event in agent.stream_handler(request)]
        assert tracing._stream_capture.get() is None
        return first, second

    first_events, second_events = asyncio.run(collect())
    assert first_events
    assert second_events
    mlflow.flush_trace_async_logging()
    rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(rows) == 2
    captures = []
    for trace_id in rows.trace_id:
        trace = mlflow.get_trace(trace_id)
        roots = [span for span in trace.data.spans if span.parent_id is None]
        model_spans = [
            span for span in trace.data.spans if span.span_type == "CHAT_MODEL"
        ]
        assert [(span.name, span.span_type) for span in roots] == [
            ("AgentRunner.run_streamed", "AGENT")
        ]
        assert roots[0].status.status_code == "OK"
        assert len(model_spans) == 1
        model = model_spans[0]
        assert model.status.status_code == "OK"
        assert model.parent_id is not None
        assert model.get_attribute("appkit.model") == "databricks-gpt-5-2"
        assert model.get_attribute("appkit.provider") == "databricks"
        assert model.get_attribute("appkit.finish_reason") == "stop"
        assert model.get_attribute("appkit.error") is None
        assert model.get_attribute("appkit.usage") == {
            "inputTokens": 5,
            "outputTokens": 2,
            "totalTokens": 7,
            "costAvailable": False,
        }
        assert model.get_attribute("appkit.cost_available") is False
        assert "appkit.cost_usd" not in model.attributes
        assert model.get_attribute("appkit.ttft_ms") >= 0
        assert model.get_attribute("appkit.stream_duration_ms") >= 0
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
        captures.append(stream_capture)
    assert captures[0]["sha256"] != captures[1]["sha256"]


def test_failed_stream_resets_capture_before_later_success(monkeypatch, tmp_path):
    tracking_uri = f"sqlite:///{tmp_path / 'stream-failure.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "simple-stream-failure", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    chunks = [
        {
            "id": "chatcmpl-recovery",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": None,
                    "delta": {"role": "assistant", "content": "Recovered."},
                }
            ],
        },
        {
            "id": "chatcmpl-recovery",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [{"index": 0, "finish_reason": "stop", "delta": {}}],
        },
        {
            "id": "chatcmpl-recovery",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [],
            "usage": {
                "prompt_tokens": 3,
                "completion_tokens": 1,
                "total_tokens": 4,
            },
        },
    ]
    success_body = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
    success_body += "data: [DONE]\n\n"
    attempts = 0

    async def transport(request):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(
                500,
                json={"error": {"message": "token streamfailuresecret"}},
                request=request,
            )
        return httpx.Response(
            200,
            content=success_body.encode(),
            headers={"content-type": "text/event-stream"},
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
    from agent_server import agent, tracing

    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "stream recovery"}],
        custom_inputs={"session_id": "stream-recovery", "request_id": "stream-recovery"},
    )

    async def fail_then_recover():
        with pytest.raises(Exception, match="streamfailuresecret"):
            _ = [event async for event in agent.stream_handler(request)]
        assert tracing._stream_capture.get() is None
        events = [event async for event in agent.stream_handler(request)]
        assert tracing._stream_capture.get() is None
        return events

    assert asyncio.run(fail_then_recover())
    mlflow.flush_trace_async_logging()
    rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(rows) == 2
    roots = []
    traces = []
    for trace_id in rows.trace_id:
        trace = mlflow.get_trace(trace_id)
        traces.append(trace)
        trace_roots = [span for span in trace.data.spans if span.parent_id is None]
        assert len(trace_roots) == 1
        roots.extend(trace_roots)
    assert sorted(root.status.status_code for root in roots) == ["ERROR", "OK"]
    assert all(root.get_attribute("appkit.stream.capture") is not None for root in roots)
    failed_root = next(root for root in roots if root.status.status_code == "ERROR")
    assert failed_root.outputs["partial_output"] == {
        "events": failed_root.get_attribute("appkit.stream.capture")
    }
    serialized = json.dumps(
        [span.to_dict() for trace in traces for span in trace.data.spans]
    )
    assert "streamfailuresecret" not in serialized
    assert "[REDACTED]" in serialized


def test_cross_task_weakref_finalizer_does_not_contaminate_origin_context(
    monkeypatch, tmp_path
):
    tracking_uri = f"sqlite:///{tmp_path / 'cross-task-finalizer.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "cross-task-finalizer", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    chunks = [
        {
            "id": "chatcmpl-abandoned",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "delta": {"role": "assistant", "content": "unused"},
                }
            ],
        },
        {
            "id": "chatcmpl-abandoned",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "databricks-gpt-5-2",
            "choices": [],
            "usage": {
                "prompt_tokens": 2,
                "completion_tokens": 1,
                "total_tokens": 3,
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
    from agent_server import agent, tracing

    finalizers = []
    original_finalize = weakref.finalize

    def capture_finalizer(*args, **kwargs):
        finalizer = original_finalize(*args, **kwargs)
        finalizers.append(finalizer)
        return finalizer

    monkeypatch.setattr(tracing.weakref, "finalize", capture_finalizer)

    async def finalize_from_another_task():
        result = agent.Runner.run_streamed(
            agent.create_agent(),
            input=[{"role": "user", "content": "abandon this stream"}],
        )
        assert tracing._stream_capture.get() is None
        assert len(finalizers) == 1
        finalizer = finalizers[0]

        async def drop_after_run_completes(stream_result):
            await stream_result.run_loop_task
            result_ref = weakref.ref(stream_result)
            del stream_result
            for _ in range(10):
                gc.collect()
                await asyncio.sleep(0)
                if result_ref() is None:
                    break
            return result_ref() is None

        drop_task = asyncio.create_task(drop_after_run_completes(result))
        del result
        assert await drop_task
        assert not finalizer.alive
        assert tracing._stream_capture.get() is None

    asyncio.run(finalize_from_another_task())
