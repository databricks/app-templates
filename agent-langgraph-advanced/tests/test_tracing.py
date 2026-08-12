import importlib
import json

import mlflow
import pytest
from mlflow.entities import SpanType
from mlflow.tracking import MlflowClient

import agent_server.tracing as tracing


class FakeModelClient:
    def __init__(self, steps):
        self._steps = iter(steps)

    async def invoke(self, prompt, request_trace):
        step = next(self._steps)
        with mlflow.start_span("agent.model", span_type=SpanType.CHAT_MODEL) as span:
            span.set_inputs(tracing.safe_trace_value(prompt))
            span.set_attributes(
                {
                    "appkit.model": step["model"],
                    "appkit.provider": step["provider"],
                    "appkit.usage": step["usage"],
                    "appkit.ttft_ms": step["ttftMs"],
                    "appkit.stream_duration_ms": step["streamDurationMs"],
                    "appkit.finish_reason": step["finishReason"],
                }
            )
            span.set_outputs(tracing.safe_trace_value(step["output"]))
        request_trace.add_model_usage(step["usage"])
        return step["output"]


class FakeLakebase:
    async def checkpoint_read(self, thread_id):
        return {"thread_id": thread_id, "state": {"turn": 1}}

    async def checkpoint_write(self, thread_id, state):
        return {"thread_id": thread_id, "version": 2}

    async def memory_read(self, user_id, query):
        return [{"key": "city", "value": {"city": "Oakland"}}]

    async def memory_write(self, user_id, key, value):
        return {"saved": key, "user_id": user_id}


def _last_trace():
    trace_id = mlflow.get_last_active_trace_id()
    assert trace_id is not None
    trace = mlflow.get_trace(trace_id, flush=True)
    assert trace is not None
    return trace


@pytest.fixture
def local_tracking(tmp_path, monkeypatch):
    tracking_uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    artifact_uri = (tmp_path / "artifacts").as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("DATABRICKS_APP_NAME", "memory-agent")
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = MlflowClient().create_experiment(
        "task-11-langgraph-advanced", artifact_location=artifact_uri
    )
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    mlflow.set_experiment(experiment_id=experiment_id)
    yield


def test_configure_mlflow_tracing_is_idempotent(monkeypatch):
    module = importlib.reload(tracing)
    calls = []
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "sqlite:////tmp/task-11-advanced.db")
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", "654")
    monkeypatch.setattr(module.mlflow, "set_tracking_uri", lambda value: calls.append(("uri", value)))
    monkeypatch.setattr(
        module.mlflow,
        "set_experiment",
        lambda **kwargs: calls.append(("experiment", kwargs)),
    )
    monkeypatch.setattr(
        module, "_langchain_autolog", lambda **kwargs: calls.append(("autolog", kwargs))
    )

    module.configure_mlflow_tracing()
    module.configure_mlflow_tracing()

    assert calls == [
        ("uri", "sqlite:////tmp/task-11-advanced.db"),
        ("experiment", {"experiment_id": "654"}),
        ("autolog", {"log_traces": True}),
    ]


@pytest.mark.asyncio
async def test_advanced_turn_traces_model_tool_memory_and_state_without_partial_cost(
    local_tracking,
):
    model = FakeModelClient(
        [
            {
                "model": "databricks-gpt-5-2",
                "provider": "databricks",
                "usage": {
                    "inputTokens": 10,
                    "outputTokens": 4,
                    "totalTokens": 14,
                    "cacheReadInputTokens": 3,
                    "costUsd": 0.02,
                    "costAvailable": True,
                },
                "ttftMs": 12,
                "streamDurationMs": 35,
                "finishReason": "tool_calls",
                "output": {"tool": "save_user_memory"},
            },
            {
                "model": "databricks-gpt-5-2",
                "provider": "databricks",
                "usage": {
                    "inputTokens": 6,
                    "outputTokens": 3,
                    "totalTokens": 9,
                    "cacheCreationInputTokens": 2,
                    "costAvailable": False,
                },
                "ttftMs": 9,
                "streamDurationMs": 20,
                "finishReason": "stop",
                "output": {"answer": "I will remember Oakland."},
            },
        ]
    )
    lakebase = FakeLakebase()
    request_input = {
        "messages": [{"role": "user", "content": "Remember that I live in Oakland"}],
        "password": "request-secret",
    }

    with tracing.agent_request_span("langgraph_advanced.request", request_input) as request_trace:
        tracing.set_request_trace_identity(
            "thread-1", "user-1", "request-1", "agent-langgraph-advanced"
        )
        async with tracing.traced_async_operation(
            "lakebase.checkpoint.read", SpanType.MEMORY, {"thread_id": "thread-1"}
        ) as operation:
            checkpoint = await lakebase.checkpoint_read("thread-1")
            operation.set_outputs(checkpoint)
        with tracing.traced_operation(
            "langgraph.state.serialize", SpanType.PARSER, {"state": checkpoint["state"]}
        ) as operation:
            state = json.dumps(checkpoint["state"], sort_keys=True)
            operation.set_outputs({"serialized": state})
        async with tracing.traced_async_operation(
            "lakebase.memory.read",
            SpanType.MEMORY,
            {"user_id": "user-1", "query": "city"},
        ) as operation:
            memories = await lakebase.memory_read("user-1", "city")
            operation.set_outputs(memories)
        first = await model.invoke({"state": state, "memories": memories}, request_trace)
        async with tracing.traced_async_operation(
            "memory.save_user_memory",
            SpanType.TOOL,
            {"memory_key": "city", "memory_data": {"city": "Oakland"}},
        ) as operation:
            async with tracing.traced_async_operation(
                "lakebase.memory.write",
                SpanType.MEMORY,
                {"user_id": "user-1", "key": "city", "value": {"city": "Oakland"}},
            ) as memory_operation:
                saved = await lakebase.memory_write(
                    "user-1", "city", {"city": "Oakland"}
                )
                memory_operation.set_outputs(saved)
            operation.set_outputs(saved)
        final = await model.invoke({"tool": first, "result": saved}, request_trace)
        async with tracing.traced_async_operation(
            "lakebase.checkpoint.write",
            SpanType.MEMORY,
            {"thread_id": "thread-1", "state": final},
        ) as operation:
            written = await lakebase.checkpoint_write("thread-1", final)
            operation.set_outputs(written)
        request_trace.set_outputs(final)

    trace = _last_trace()
    roots = [span for span in trace.data.spans if span.parent_id is None]
    assert [(span.name, span.span_type) for span in roots] == [
        ("langgraph_advanced.request", SpanType.AGENT)
    ]
    assert len([s for s in trace.data.spans if s.span_type == SpanType.CHAT_MODEL]) == 2
    assert len([s for s in trace.data.spans if s.span_type == SpanType.TOOL]) == 1
    assert sorted(s.name for s in trace.data.spans if s.span_type == SpanType.MEMORY) == [
        "lakebase.checkpoint.read",
        "lakebase.checkpoint.write",
        "lakebase.memory.read",
        "lakebase.memory.write",
    ]
    assert [s.name for s in trace.data.spans if s.span_type == SpanType.PARSER] == [
        "langgraph.state.serialize"
    ]
    root = roots[0]
    assert root.inputs["password"] == "[REDACTED]"
    assert root.outputs == {"answer": "I will remember Oakland."}
    assert root.get_attribute("appkit.usage") == {
        "inputTokens": 16,
        "outputTokens": 7,
        "totalTokens": 23,
        "cacheReadInputTokens": 3,
        "cacheCreationInputTokens": 2,
        "costAvailable": False,
    }
    assert "costUsd" not in root.get_attribute("appkit.usage")
    assert trace.info.trace_metadata["mlflow.trace.session"] == "thread-1"
    assert trace.info.trace_metadata["mlflow.trace.user"] == "user-1"
    assert trace.info.trace_metadata["appkit.app.name"] == "memory-agent"
    assert trace.info.trace_metadata["appkit.request.id"] == "request-1"
    assert trace.info.tags["template"] == "agent-langgraph-advanced"
    assert trace.info.tags["agent"] == "default"


@pytest.mark.asyncio
async def test_advanced_memory_failure_finalizes_all_open_spans(local_tracking):
    async def fail_memory_write():
        raise RuntimeError("Lakebase password lakebase-secret rejected")

    with pytest.raises(RuntimeError, match="lakebase-secret"):
        with tracing.agent_request_span(
            "langgraph_advanced.request", {"password": "request-secret"}
        ):
            tracing.set_request_trace_identity(
                "thread-error", "user-error", "request-error", "agent-langgraph-advanced"
            )
            async with tracing.traced_async_operation(
                "lakebase.memory.write",
                SpanType.MEMORY,
                {"password": "lakebase-secret"},
            ):
                await fail_memory_write()

    trace = _last_trace()
    spans = trace.data.spans
    assert sorted((span.span_type, span.status.status_code) for span in spans) == [
        (SpanType.AGENT, "ERROR"),
        (SpanType.MEMORY, "ERROR"),
    ]
    assert all(span.end_time_ns is not None for span in spans)
    exported = json.dumps(trace.to_dict(), sort_keys=True)
    assert "request-secret" not in exported
    assert "lakebase-secret" not in exported
    assert "[REDACTED]" in exported


def test_safe_trace_value_redacts_and_truncates_on_utf8_boundaries():
    captured = tracing.safe_trace_value(
        {"api_key": "secret", "payload": "é" * 100}, max_bytes=64
    )

    assert captured["truncated"] is True
    assert captured["originalBytes"] > 64
    assert len(captured["sha256"]) == 64
    assert captured["preview"].encode("utf-8").decode("utf-8") == captured["preview"]
    assert "secret" not in json.dumps(captured)


def test_langchain_usage_callback_marks_missing_model_cost_unavailable(local_tracking):
    class Message:
        usage_metadata = {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7}
        response_metadata = {}

    class Generation:
        message = Message()

    class Result:
        generations = [[Generation()]]
        llm_output = {"model_name": "unpriced-model"}

    with tracing.agent_request_span(
        "langgraph_advanced.request", {"message": "hello"}
    ) as request_trace:
        callback = tracing.LangChainUsageCallback(request_trace)
        callback.on_llm_end(Result())
        request_trace.set_outputs({"answer": "hi"})

    root_usage = _last_trace().data.spans[0].get_attribute("appkit.usage")
    assert root_usage == {
        "inputTokens": 5,
        "outputTokens": 2,
        "totalTokens": 7,
        "costAvailable": False,
    }


@pytest.mark.asyncio
async def test_stream_handler_wraps_advanced_graph_in_one_identified_agent_root(
    local_tracking, monkeypatch
):
    from contextlib import asynccontextmanager

    from langchain_core.messages import AIMessage
    from mlflow.types.responses import ResponsesAgentRequest

    from agent_server import agent as agent_module

    class FakeGraph:
        async def astream(self, input, config, stream_mode):
            yield ("updates", {"agent": {"messages": [AIMessage(content="hi", id="m1")]}})

    @asynccontextmanager
    async def fake_resources(config):
        yield object(), object()

    async def fake_init_agent(*args, **kwargs):
        return FakeGraph()

    monkeypatch.setattr(agent_module, "acquire_lakebase_resources", fake_resources)
    monkeypatch.setattr(agent_module, "TracedCheckpointSaver", lambda value: value)
    monkeypatch.setattr(agent_module, "init_agent", fake_init_agent)
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "hello"}],
        custom_inputs={
            "thread_id": "thread-stream",
            "user_id": "user-stream",
            "request_id": "request-stream",
        },
    )

    events = [event async for event in agent_module.stream_handler(request)]

    assert any(event.type == "response.output_item.done" for event in events)
    trace = _last_trace()
    roots = [span for span in trace.data.spans if span.parent_id is None]
    assert [(span.name, span.span_type) for span in roots] == [
        ("langgraph_advanced.request", SpanType.AGENT)
    ]
    assert trace.info.trace_metadata["mlflow.trace.session"] == "thread-stream"
    assert trace.info.trace_metadata["mlflow.trace.user"] == "user-stream"
    assert trace.info.trace_metadata["appkit.request.id"] == "request-stream"
