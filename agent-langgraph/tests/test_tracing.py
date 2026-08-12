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


class FakeMCPClient:
    async def call_tool(self, arguments):
        return {"temperature": 68, "units": "F", "api_key": "tool-secret"}


class FailingMCPClient:
    async def call_tool(self, arguments):
        raise RuntimeError("MCP failed with bearer super-secret")


def _last_trace():
    trace_id = mlflow.get_last_active_trace_id()
    assert trace_id is not None
    trace = mlflow.get_trace(trace_id, flush=True)
    assert trace is not None
    return trace


def _span(trace, span_type):
    matches = [span for span in trace.data.spans if span.span_type == span_type]
    assert len(matches) == 1
    return matches[0]


def _event_text(span):
    return json.dumps([event.json() for event in span.events], sort_keys=True)


@pytest.fixture
def local_tracking(tmp_path, monkeypatch):
    tracking_uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    artifact_uri = (tmp_path / "artifacts").as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("DATABRICKS_APP_NAME", "weather-agent")
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = MlflowClient().create_experiment(
        "task-11-langgraph", artifact_location=artifact_uri
    )
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    mlflow.set_experiment(experiment_id=experiment_id)
    yield


def test_configure_mlflow_tracing_is_idempotent(monkeypatch):
    module = importlib.reload(tracing)
    calls = []
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "sqlite:////tmp/task-11.db")
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", "321")
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
        ("uri", "sqlite:////tmp/task-11.db"),
        ("experiment", {"experiment_id": "321"}),
        ("autolog", {"log_traces": True}),
    ]


@pytest.mark.asyncio
async def test_tool_turn_has_one_safe_complete_semantic_tree(local_tracking):
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
                    "cacheCreationInputTokens": 1,
                    "costUsd": 0.02,
                    "costAvailable": True,
                },
                "ttftMs": 12,
                "streamDurationMs": 35,
                "finishReason": "tool_calls",
                "output": {"tool": "weather", "arguments": {"city": "Oakland"}},
            },
            {
                "model": "databricks-gpt-5-2",
                "provider": "databricks",
                "usage": {
                    "inputTokens": 6,
                    "outputTokens": 3,
                    "totalTokens": 9,
                    "cacheReadInputTokens": 2,
                    "costUsd": 0.01,
                    "costAvailable": True,
                },
                "ttftMs": 9,
                "streamDurationMs": 20,
                "finishReason": "stop",
                "output": {"answer": "It is 68 F in Oakland."},
            },
        ]
    )
    mcp = FakeMCPClient()
    request_input = {
        "messages": [{"role": "user", "content": "Weather in Oakland?"}],
        "access_token": "request-secret",
    }

    with tracing.agent_request_span("langgraph.request", request_input) as request_trace:
        tracing.set_request_trace_identity(
            session_id="session-1",
            user_id="user-1",
            request_id="request-1",
            template_name="agent-langgraph",
        )
        first = await model.invoke(request_input["messages"], request_trace)
        async with tracing.traced_async_operation(
            "mcp.weather",
            SpanType.TOOL,
            {"name": first["tool"], "arguments": first["arguments"]},
        ) as operation:
            tool_output = await mcp.call_tool(first["arguments"])
            operation.set_outputs(tool_output)
        final = await model.invoke(
            {"messages": request_input["messages"], "tool_output": tool_output},
            request_trace,
        )
        request_trace.set_outputs(final)

    trace = _last_trace()
    roots = [span for span in trace.data.spans if span.parent_id is None]
    assert [(span.name, span.span_type) for span in roots] == [
        ("langgraph.request", SpanType.AGENT)
    ]
    assert len([s for s in trace.data.spans if s.span_type == SpanType.CHAT_MODEL]) == 2
    tool_span = _span(trace, SpanType.TOOL)
    assert tool_span.inputs == {
        "arguments": {"city": "Oakland"},
        "name": "weather",
    }
    assert tool_span.outputs == {
        "api_key": "[REDACTED]",
        "temperature": 68,
        "units": "F",
    }

    root = roots[0]
    assert root.inputs == {
        "access_token": "[REDACTED]",
        "messages": [{"content": "Weather in Oakland?", "role": "user"}],
    }
    assert root.outputs == {"answer": "It is 68 F in Oakland."}
    assert root.get_attribute("appkit.usage") == {
        "inputTokens": 16,
        "outputTokens": 7,
        "totalTokens": 23,
        "cacheReadInputTokens": 5,
        "cacheCreationInputTokens": 1,
        "costAvailable": True,
        "costUsd": 0.03,
    }
    assert trace.info.trace_metadata == {
        **trace.info.trace_metadata,
        "mlflow.trace.session": "session-1",
        "mlflow.trace.user": "user-1",
        "appkit.app.name": "weather-agent",
        "appkit.request.id": "request-1",
    }
    assert trace.info.tags["template"] == "agent-langgraph"
    assert trace.info.tags["agent"] == "default"


@pytest.mark.asyncio
async def test_failure_finalizes_tool_and_agent_spans_without_leaking_credentials(local_tracking):
    with pytest.raises(RuntimeError, match="super-secret"):
        with tracing.agent_request_span(
            "langgraph.request", {"authorization": "Bearer request-secret"}
        ):
            tracing.set_request_trace_identity(
                "session-error", "user-error", "request-error", "agent-langgraph"
            )
            async with tracing.traced_async_operation(
                "mcp.health",
                SpanType.TOOL,
                {"authorization": "Bearer tool-secret"},
            ):
                await FailingMCPClient().call_tool({})

    trace = _last_trace()
    root = _span(trace, SpanType.AGENT)
    tool_span = _span(trace, SpanType.TOOL)
    assert root.status.status_code == "ERROR"
    assert tool_span.status.status_code == "ERROR"
    assert root.end_time_ns is not None
    assert tool_span.end_time_ns is not None
    exported = json.dumps(trace.to_dict(), sort_keys=True)
    assert "request-secret" not in exported
    assert "tool-secret" not in exported
    assert "super-secret" not in exported
    assert "[REDACTED]" in exported
    assert "RuntimeError: MCP failed with bearer [REDACTED]" in _event_text(tool_span)


def test_safe_trace_value_redacts_and_truncates_on_utf8_boundaries():
    captured = tracing.safe_trace_value(
        {"token": "secret", "payload": "é" * 100}, max_bytes=64
    )

    assert captured["truncated"] is True
    assert captured["originalBytes"] > 64
    assert len(captured["sha256"]) == 64
    assert captured["preview"].encode("utf-8").decode("utf-8") == captured["preview"]
    assert "secret" not in json.dumps(captured)


def test_langchain_usage_callback_totals_each_model_iteration(local_tracking):
    class Message:
        usage_metadata = {
            "input_tokens": 8,
            "output_tokens": 3,
            "total_tokens": 11,
            "input_token_details": {"cache_read": 2, "cache_creation": 1},
        }
        response_metadata = {"total_cost_usd": 0.04}

    class Generation:
        message = Message()

    class Result:
        generations = [[Generation()]]
        llm_output = {"model_name": "databricks-gpt-5-2"}

    with tracing.agent_request_span("langgraph.request", {"message": "hello"}) as request_trace:
        callback = tracing.LangChainUsageCallback(request_trace)
        callback.on_llm_end(Result())
        request_trace.set_outputs({"answer": "hi"})

    root = _span(_last_trace(), SpanType.AGENT)
    assert root.get_attribute("appkit.usage") == {
        "inputTokens": 8,
        "outputTokens": 3,
        "totalTokens": 11,
        "cacheReadInputTokens": 2,
        "cacheCreationInputTokens": 1,
        "costAvailable": True,
        "costUsd": 0.04,
    }


@pytest.mark.asyncio
async def test_stream_handler_wraps_graph_in_one_identified_agent_root(
    local_tracking, monkeypatch
):
    from langchain_core.messages import AIMessage
    from mlflow.types.responses import ResponsesAgentRequest

    from agent_server import agent as agent_module

    class FakeGraph:
        async def astream(self, input, *args, **kwargs):
            yield ("updates", {"agent": {"messages": [AIMessage(content="hi", id="m1")]}})

    async def fake_init_agent(*args, **kwargs):
        return FakeGraph()

    monkeypatch.setattr(agent_module, "init_agent", fake_init_agent)
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "hello"}],
        user="user-stream",
        custom_inputs={
            "session_id": "session-stream",
            "request_id": "request-stream",
        },
    )

    events = [event async for event in agent_module.stream_handler(request)]

    assert any(event.type == "response.output_item.done" for event in events)
    trace = _last_trace()
    roots = [span for span in trace.data.spans if span.parent_id is None]
    assert [(span.name, span.span_type) for span in roots] == [
        ("langgraph.request", SpanType.AGENT)
    ]
    assert trace.info.trace_metadata["mlflow.trace.session"] == "session-stream"
    assert trace.info.trace_metadata["mlflow.trace.user"] == "user-stream"
    assert trace.info.trace_metadata["appkit.request.id"] == "request-stream"
