import importlib
import hashlib
import json
import time

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
    from mlflow.tracing.trace_manager import InMemoryTraceManager

    with InMemoryTraceManager.get_instance().get_trace(trace_id) as pending:
        if pending is not None:
            return pending.to_mlflow_trace()
    mlflow.flush_trace_async_logging()
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if trace := mlflow.get_trace(trace_id, silent=True):
            return trace
        time.sleep(0.1)
    pytest.fail(f"Trace {trace_id} was neither in memory nor persisted")


def _span(trace, span_type, *, name=None):
    matches = [
        span
        for span in trace.data.spans
        if span.span_type == span_type and (name is None or span.name == name)
    ]
    assert len(matches) == 1
    return matches[0]


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
    monkeypatch.setattr(
        module.mlflow, "set_tracking_uri", lambda value: calls.append(("uri", value))
    )
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

    with tracing.agent_request_span(
        "langgraph_advanced.request", request_input
    ) as request_trace:
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
        first = await model.invoke(
            {"state": state, "memories": memories}, request_trace
        )
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
    assert sorted(
        s.name for s in trace.data.spans if s.span_type == SpanType.MEMORY
    ) == [
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
                "thread-error",
                "user-error",
                "request-error",
                "agent-langgraph-advanced",
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


def test_safe_trace_value_redacts_credentials_from_fallback_repr():
    class CredentialObject:
        def __repr__(self):
            return (
                "CredentialObject(Authorization=Bearer auth-secret, "
                "cookie=session-cookie, api_key=api-secret, "
                "credential=credential-secret, password=password-secret, "
                "secret=secret-secret, token=token-secret)"
            )

    captured = tracing.safe_trace_value({"value": CredentialObject()})
    encoded = json.dumps(captured, sort_keys=True)

    assert "auth-secret" not in encoded
    assert "session-cookie" not in encoded
    assert "api-secret" not in encoded
    assert "credential-secret" not in encoded
    assert "password-secret" not in encoded
    assert "secret-secret" not in encoded
    assert "token-secret" not in encoded
    assert encoded.count("[REDACTED]") == 7


def test_safe_trace_value_redacts_quoted_whitespace_and_escaped_repr_values():
    class CredentialObject:
        def __repr__(self):
            return (
                "CredentialObject("
                "authorization='Bearer single auth secret', "
                'Authorization="Bearer double auth secret", '
                "cookie='single cookie secret', "
                'Cookie="double cookie secret", '
                "api_key='single api \\'quoted\\' secret', "
                'api-key="double api \\"quoted\\" secret", '
                "credential='single credential secret', "
                'Credential="double credential secret", '
                "password='single password secret', "
                'Password="double password secret", '
                "secret='single secret phrase', "
                'Secret="double secret phrase", '
                "token='single token secret', "
                'Token="double token secret", '
                "region='us west', retries=3, "
                "note=\"ordinary prose stays visible!\", tail='done')"
            )

    raw = repr(CredentialObject())
    secrets = [
        "single auth secret",
        "double auth secret",
        "single cookie secret",
        "double cookie secret",
        "single api \\'quoted\\' secret",
        'double api \\"quoted\\" secret',
        "single credential secret",
        "double credential secret",
        "single password secret",
        "double password secret",
        "single secret phrase",
        "double secret phrase",
        "single token secret",
        "double token secret",
    ]
    captured = tracing.safe_trace_value({"value": CredentialObject()})
    truncated = tracing.safe_trace_value(
        {"value": CredentialObject(), "zz_padding": "visible-" * 300}, max_bytes=512
    )
    exception_text = tracing.safe_error_message(RuntimeError(raw))
    encoded_outputs = [
        captured["value"],
        truncated["preview"],
        json.dumps(captured, sort_keys=True),
        json.dumps(truncated, sort_keys=True),
        exception_text,
    ]

    for secret in secrets:
        assert all(secret not in output for output in encoded_outputs)
    assert captured["value"].count("[REDACTED]") == 14
    assert "authorization='[REDACTED]'" in captured["value"]
    assert 'Authorization="[REDACTED]"' in captured["value"]
    assert (
        "region='us west', retries=3, "
        "note=\"ordinary prose stays visible!\", tail='done')" in captured["value"]
    )
    assert truncated["truncated"] is True
    assert set(truncated) == {"truncated", "originalBytes", "sha256", "preview"}
    assert len(truncated["sha256"]) == 64
    assert "[REDACTED]" in truncated["preview"]
    assert "region='us west'" in exception_text


def test_safe_trace_value_preserves_ordinary_credential_prose():
    prose = (
        "Password policies, token counts, secret sharing, cookie settings, "
        "credential formats, api-key rotation, authorization guides, and "
        "Bearer authentication remain readable."
    )

    assert tracing.safe_trace_value(prose) == prose


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
            yield (
                "updates",
                {"agent": {"messages": [AIMessage(content="hi", id="m1")]}},
            )

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


@pytest.mark.asyncio
async def test_production_mcp_constructor_and_health_are_traced(
    local_tracking, monkeypatch
):
    from agent_server import utils as utils_module

    class FakeServer:
        def __init__(self, **kwargs):
            self.name = kwargs["name"]
            self.url = kwargs["url"]
            self.workspace_client = kwargs["workspace_client"]

    class FakeTool:
        name = "system.ai.test"

    class FakeMultiServerClient:
        def __init__(self, servers):
            self.servers = servers

        async def get_tools(self):
            return [FakeTool()]

    workspace_client = object()
    monkeypatch.setattr(utils_module, "DatabricksMCPServer", FakeServer)
    monkeypatch.setattr(
        utils_module, "DatabricksMultiServerMCPClient", FakeMultiServerClient
    )
    monkeypatch.setattr(
        utils_module,
        "get_databricks_host_from_env",
        lambda: "https://workspace.example",
    )

    with tracing.agent_request_span(
        "langgraph_advanced.request", {"message": "init mcp"}
    ) as root:
        client = utils_module.init_mcp_client(workspace_client)
        tools = await utils_module.get_mcp_tools(client)
        root.set_outputs({"tool_names": [item.name for item in tools]})

    spans = sorted(
        [span for span in _last_trace().data.spans if span.span_type == SpanType.TOOL],
        key=lambda span: span.name,
    )
    assert [span.name for span in spans] == ["mcp.health", "mcp.initialize"]
    assert spans[0].inputs == {"operation": "get_tools"}
    assert spans[0].outputs == {"tools": ["system.ai.test"]}
    assert spans[1].inputs == {"servers": [{"name": "system-ai"}]}
    assert spans[1].outputs == {
        "initialized": True,
        "server_count": 1,
        "servers": [
            {"url": "https://workspace.example/api/2.0/mcp/functions/system/ai"}
        ],
    }
    assert client.servers[0].workspace_client is workspace_client


@pytest.mark.asyncio
async def test_stream_handler_captures_large_event_stream_incrementally(
    local_tracking, monkeypatch
):
    from contextlib import asynccontextmanager

    from langchain_core.messages import AIMessage
    from langgraph.store.memory import InMemoryStore
    from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentStreamEvent

    from agent_server import agent as agent_module

    class TrackedDump(dict):
        live = 0
        max_live = 0

        def __init__(self, value):
            super().__init__(value)
            type(self).live += 1
            type(self).max_live = max(type(self).max_live, type(self).live)

        def __del__(self):
            type(self).live -= 1

    class FakeGraph:
        async def astream(self, input, config, stream_mode):
            for index in range(12):
                yield (
                    "updates",
                    {
                        "agent": {
                            "messages": [
                                AIMessage(
                                    content=f"{index}:" + "é" * 8192,
                                    id=f"m{index}",
                                )
                            ]
                        }
                    },
                )

    @asynccontextmanager
    async def fake_resources(config):
        yield object(), InMemoryStore()

    async def fake_init_agent(*args, **kwargs):
        return FakeGraph()

    original_model_dump = ResponsesAgentStreamEvent.model_dump

    def tracked_model_dump(self, *args, **kwargs):
        return TrackedDump(original_model_dump(self, *args, **kwargs))

    monkeypatch.setattr(agent_module, "acquire_lakebase_resources", fake_resources)
    monkeypatch.setattr(agent_module, "TracedCheckpointSaver", lambda value: value)
    monkeypatch.setattr(agent_module, "init_agent", fake_init_agent)
    monkeypatch.setattr(ResponsesAgentStreamEvent, "model_dump", tracked_model_dump)
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "stream a large response"}],
        custom_inputs={
            "thread_id": "thread-bounded",
            "user_id": "user-bounded",
            "request_id": "request-bounded",
        },
    )

    digest = hashlib.sha256()
    digest.update(b"[")
    original_bytes = 1
    event_count = 0
    async for event in agent_module.stream_handler(request):
        encoded = json.dumps(
            original_model_dump(event, exclude_none=True),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        if event_count:
            digest.update(b",")
            original_bytes += 1
        digest.update(encoded)
        original_bytes += len(encoded)
        event_count += 1
    digest.update(b"]")
    original_bytes += 1

    trace = _last_trace()
    root = _span(trace, SpanType.AGENT)
    parser = _span(trace, SpanType.PARSER, name="langgraph.response.parse")
    assert event_count > 24
    assert TrackedDump.max_live <= 4
    for span in (root, parser):
        capture = span.outputs["events"]
        assert capture["truncated"] is True
        assert capture["originalBytes"] == original_bytes
        assert capture["sha256"] == digest.hexdigest()
        assert len(capture["preview"].encode("utf-8")) <= 64 * 1024
        capture["preview"].encode("utf-8").decode("utf-8")


@pytest.mark.asyncio
async def test_handler_tool_turn_enriches_existing_autologged_model_spans(
    local_tracking, monkeypatch
):
    from contextlib import asynccontextmanager

    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.tools import tool
    from langgraph.store.memory import InMemoryStore
    from mlflow.types.responses import ResponsesAgentRequest
    from pydantic import PrivateAttr

    from agent_server import agent as agent_module

    importlib.reload(tracing)

    class PatchedChatDatabricks(BaseChatModel):
        _iteration: int = PrivateAttr(default=0)

        @property
        def _llm_type(self):
            return "databricks-chat"

        @property
        def _identifying_params(self):
            return {"model": "databricks-test-model"}

        def _get_ls_params(self, *args, **kwargs):
            return {
                "ls_provider": "databricks",
                "ls_model_name": "databricks-test-model",
                "ls_model_type": "chat",
            }

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            if self._iteration == 0:
                message = AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "get_current_time",
                            "args": {},
                            "id": "call-1",
                            "type": "tool_call",
                        }
                    ],
                    usage_metadata={
                        "input_tokens": 10,
                        "output_tokens": 4,
                        "total_tokens": 14,
                        "input_token_details": {"cache_read": 3, "cache_creation": 1},
                    },
                    response_metadata={
                        "finish_reason": "tool_calls",
                        "total_cost_usd": 0.02,
                    },
                )
            else:
                message = AIMessage(
                    content="It is test time.",
                    usage_metadata={
                        "input_tokens": 6,
                        "output_tokens": 3,
                        "total_tokens": 9,
                        "input_token_details": {"cache_read": 2},
                    },
                    response_metadata={"finish_reason": "stop", "total_cost_usd": 0.01},
                )
            self._iteration += 1
            return ChatResult(
                generations=[ChatGeneration(message=message)],
                llm_output={
                    "model_name": "databricks-test-model",
                    "token_usage": message.usage_metadata,
                },
            )

    @tool
    async def fixed_time():
        """Get the current date and time."""
        return "2026-08-12T10:00:00"

    fixed_time.name = "get_current_time"

    @asynccontextmanager
    async def fake_resources(config):
        yield object(), InMemoryStore()

    monkeypatch.setattr(agent_module, "ChatDatabricks", PatchedChatDatabricks)
    monkeypatch.setattr(agent_module, "get_current_time", fixed_time)
    monkeypatch.setattr(agent_module, "acquire_lakebase_resources", fake_resources)
    monkeypatch.setattr(agent_module, "TracedCheckpointSaver", lambda value: None)
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "What time is it?"}],
        custom_inputs={
            "thread_id": "thread-production",
            "user_id": "user-production",
            "request_id": "request-production",
        },
    )

    events = [event async for event in agent_module.stream_handler(request)]

    trace = _last_trace()
    roots = [span for span in trace.data.spans if span.parent_id is None]
    model_spans = sorted(
        [span for span in trace.data.spans if span.span_type == SpanType.CHAT_MODEL],
        key=lambda span: span.start_time_ns,
    )
    tool_spans = [span for span in trace.data.spans if span.span_type == SpanType.TOOL]
    assert len(roots) == 1
    assert roots[0].span_type == SpanType.AGENT
    assert len(model_spans) == 2
    assert len(tool_spans) == 1
    assert all(span.trace_id == roots[0].trace_id for span in model_spans + tool_spans)
    assert all(span.parent_id is not None for span in model_spans + tool_spans)
    assert any(event.type == "response.output_item.done" for event in events)
    assert [span.get_attribute("appkit.model") for span in model_spans] == [
        "databricks-test-model",
        "databricks-test-model",
    ]
    assert [span.get_attribute("appkit.provider") for span in model_spans] == [
        "databricks",
        "databricks",
    ]
    assert [span.get_attribute("appkit.finish_reason") for span in model_spans] == [
        "tool_calls",
        "stop",
    ]
    assert [span.get_attribute("appkit.cost_available") for span in model_spans] == [
        True,
        True,
    ]
    assert [span.get_attribute("appkit.cost_usd") for span in model_spans] == [
        0.02,
        0.01,
    ]
    assert [span.get_attribute("appkit.usage") for span in model_spans] == [
        {
            "inputTokens": 10,
            "outputTokens": 4,
            "totalTokens": 14,
            "cacheReadInputTokens": 3,
            "cacheCreationInputTokens": 1,
            "costAvailable": True,
            "costUsd": 0.02,
        },
        {
            "inputTokens": 6,
            "outputTokens": 3,
            "totalTokens": 9,
            "cacheReadInputTokens": 2,
            "costAvailable": True,
            "costUsd": 0.01,
        },
    ]
    assert all(span.get_attribute("appkit.ttft_ms") >= 0 for span in model_spans)
    assert all(
        span.get_attribute("appkit.stream_duration_ms") >= 0 for span in model_spans
    )
    assert roots[0].get_attribute("appkit.usage") == {
        "inputTokens": 16,
        "outputTokens": 7,
        "totalTokens": 23,
        "cacheReadInputTokens": 5,
        "cacheCreationInputTokens": 1,
        "costAvailable": True,
        "costUsd": 0.03,
    }


@pytest.mark.asyncio
async def test_handler_model_failure_finalizes_enriched_model_span_safely(
    local_tracking, monkeypatch
):
    from contextlib import asynccontextmanager

    from langchain_core.language_models.chat_models import BaseChatModel
    from langgraph.store.memory import InMemoryStore
    from mlflow.types.responses import ResponsesAgentRequest

    from agent_server import agent as agent_module

    importlib.reload(tracing)

    class FailingChatDatabricks(BaseChatModel):
        @property
        def _llm_type(self):
            return "databricks-chat"

        @property
        def _identifying_params(self):
            return {"model": "databricks-failing-model"}

        def _get_ls_params(self, *args, **kwargs):
            return {
                "ls_provider": "databricks",
                "ls_model_name": "databricks-failing-model",
                "ls_model_type": "chat",
            }

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            raise RuntimeError("model failed with bearer super-secret")

    @asynccontextmanager
    async def fake_resources(config):
        yield object(), InMemoryStore()

    monkeypatch.setattr(agent_module, "ChatDatabricks", FailingChatDatabricks)
    monkeypatch.setattr(agent_module, "acquire_lakebase_resources", fake_resources)
    monkeypatch.setattr(agent_module, "TracedCheckpointSaver", lambda value: None)
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "fail safely"}],
        custom_inputs={
            "thread_id": "thread-error",
            "user_id": "user-error",
            "request_id": "request-error",
        },
    )

    with pytest.raises(RuntimeError, match="super-secret"):
        _ = [event async for event in agent_module.stream_handler(request)]

    trace = _last_trace()
    root = _span(trace, SpanType.AGENT)
    model_span = _span(trace, SpanType.CHAT_MODEL)
    assert root.status.status_code == "ERROR"
    assert model_span.status.status_code == "ERROR"
    assert model_span.end_time_ns is not None
    assert model_span.get_attribute("appkit.model") == "databricks-failing-model"
    assert model_span.get_attribute("appkit.provider") == "databricks"
    assert model_span.get_attribute("appkit.finish_reason") == "error"
    assert (
        model_span.get_attribute("appkit.error")
        == "model failed with bearer [REDACTED]"
    )
    assert model_span.get_attribute("appkit.usage") == {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "costAvailable": False,
    }
    assert model_span.get_attribute("appkit.cost_available") is False
    assert model_span.get_attribute("appkit.cost_usd") is None
    assert model_span.get_attribute("appkit.ttft_ms") >= 0
    assert model_span.get_attribute("appkit.stream_duration_ms") >= 0
    exported = json.dumps(model_span.to_dict(), sort_keys=True)
    assert "super-secret" not in exported
    assert "[REDACTED]" in exported
