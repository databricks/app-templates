from __future__ import annotations

import asyncio
import json
import os
from types import SimpleNamespace

import httpx

os.environ.setdefault("MLFLOW_DISABLE_TELEMETRY", "true")

import mlflow
from agents import set_default_openai_client
from openai import AsyncOpenAI
from mlflow.types.responses import ResponsesAgentRequest
from mcp.types import CallToolResult, TextContent, Tool


def test_real_runner_remote_handoffs_propagate_and_link(monkeypatch, tmp_path):
    tracking_uri = f"sqlite:///{tmp_path / 'multi.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "multi-remote", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    local_responses = [
        {
            "id": "chatcmpl-app",
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
                                "id": "call-app",
                                "type": "function",
                                "function": {
                                    "name": "query_app_agent",
                                    "arguments": json.dumps({"question": "ask app"}),
                                },
                            }
                        ],
                    },
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
        },
        {
            "id": "chatcmpl-serving",
            "object": "chat.completion",
            "created": 2,
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
                                "id": "call-serving",
                                "type": "function",
                                "function": {
                                    "name": "query_serving_endpoint",
                                    "arguments": json.dumps({"question": "ask endpoint"}),
                                },
                            }
                        ],
                    },
                }
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14},
        },
        {
            "id": "chatcmpl-final",
            "object": "chat.completion",
            "created": 3,
            "model": "databricks-gpt-5-2",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": "Delegation complete."},
                }
            ],
            "usage": {"prompt_tokens": 14, "completion_tokens": 3, "total_tokens": 17},
        },
    ]

    async def local_transport(request):
        return httpx.Response(200, json=local_responses.pop(0), request=request)

    local_client = AsyncOpenAI(
        api_key="local-key",
        base_url="https://local.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(local_transport)),
    )
    final_wire_requests = []

    async def remote_transport(request):
        headers = {key.lower(): value for key, value in request.headers.items()}
        body = json.loads(request.content)
        final_wire_requests.append({"headers": headers, "body": body})
        traceparent = headers["traceparent"]
        if body["model"] == "apps/specialist-app":
            remote_trace_id = traceparent.split("-")[1]
            remote_span_id = "1111111111111111"
        else:
            remote_trace_id = "22222222222222222222222222222222"
            remote_span_id = "3333333333333333"
        payload = {
            "id": f"resp_{len(final_wire_requests)}",
            "object": "response",
            "created_at": len(final_wire_requests),
            "status": "completed",
            "error": None,
            "incomplete_details": None,
            "instructions": None,
            "max_output_tokens": None,
            "model": body["model"],
            "output": [
                {
                    "id": f"msg_{len(final_wire_requests)}",
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {
                            "type": "output_text",
                            "text": f"response from {body['model']}",
                            "annotations": [],
                        }
                    ],
                }
            ],
            "parallel_tool_calls": True,
            "previous_response_id": None,
            "reasoning": None,
            "store": True,
            "temperature": None,
            "text": {"format": {"type": "text"}},
            "tool_choice": "auto",
            "tools": [],
            "top_p": None,
            "truncation": "disabled",
            "usage": {
                "input_tokens": 4,
                "input_tokens_details": {"cached_tokens": 0},
                "output_tokens": 2,
                "output_tokens_details": {"reasoning_tokens": 0},
                "total_tokens": 6,
                "cost_usd": 0.01,
            },
            "user": None,
            "metadata": {
                "trace_id": remote_trace_id,
                "root_span_id": remote_span_id,
            },
        }
        return httpx.Response(200, json=payload, request=request)

    remote_client = AsyncOpenAI(
        api_key="remote-key",
        base_url="https://remote.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(remote_transport)),
    )
    clients = iter([local_client, remote_client])
    import databricks_openai

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: next(clients))
    set_default_openai_client(local_client)
    from agent_server import agent
    from agents.tracing.setup import get_trace_provider
    from mlflow.openai._agent_tracer import MlflowOpenAgentTracingProcessor

    processors = get_trace_provider()._multi_processor._processors
    assert len(processors) == 1
    assert isinstance(processors[0], MlflowOpenAgentTracingProcessor)

    monkeypatch.setattr(agent, "build_mcp_url", lambda path: f"https://test.invalid{path}")
    agent.SUBAGENTS = [
        {
            "name": "app_agent",
            "type": "app",
            "endpoint": "specialist-app",
            "description": "Delegate to the app agent.",
        },
        {
            "name": "serving_endpoint",
            "type": "serving_endpoint",
            "endpoint": "specialist-endpoint",
            "description": "Delegate to the serving endpoint.",
        },
    ]
    agent.subagent_tools = [agent._make_subagent_tool(item) for item in agent.SUBAGENTS]

    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "Use both specialists."}],
        custom_inputs={
            "session_id": "multi-session",
            "user_id": "multi-user",
            "request_id": "multi-request",
        },
    )
    response = asyncio.run(agent.invoke_handler(request))
    assert response.output[-1].content[0]["text"] == "Delegation complete."
    assert len(final_wire_requests) == 2
    assert all(
        item["headers"]["authorization"] == "Bearer remote-key"
        for item in final_wire_requests
    )
    traceparents = [item["headers"]["traceparent"] for item in final_wire_requests]
    assert len(set(traceparents)) == 2
    assert [item["body"]["model"] for item in final_wire_requests] == [
        "apps/specialist-app",
        "specialist-endpoint",
    ]

    mlflow.flush_trace_async_logging()
    rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(rows) == 1
    trace = mlflow.get_trace(rows.iloc[0].trace_id)
    roots = [span for span in trace.data.spans if span.parent_id is None]
    remote_spans = [
        span
        for span in trace.data.spans
        if span.name in {"remote.app_agent", "remote.serving_endpoint"}
    ]
    model_spans = [span for span in trace.data.spans if span.span_type == "CHAT_MODEL"]
    workflow = next(span for span in trace.data.spans if span.name == "Agent workflow")
    assert workflow.inputs["data"]["sdk_span_type"] == "task"
    assert workflow.inputs["data"]["name"] == workflow.name
    assert [(span.name, span.span_type) for span in roots] == [
        ("AgentRunner.run", "AGENT")
    ]
    assert [span.name for span in remote_spans] == [
        "remote.app_agent",
        "remote.serving_endpoint",
    ]
    assert all(span.status.status_code == "OK" for span in remote_spans)
    assert [span.inputs for span in remote_spans] == [
        {"input": "ask app"},
        {"input": "ask endpoint"},
    ]
    assert [span.get_attribute("appkit.remote.target_type") for span in remote_spans] == [
        "app",
        "serving_endpoint",
    ]
    assert [span.get_attribute("appkit.remote.target_name") for span in remote_spans] == [
        "specialist-app",
        "specialist-endpoint",
    ]
    assert [span.get_attribute("appkit.remote.status") for span in remote_spans] == [
        "OK",
        "OK",
    ]
    assert [span.get_attribute("appkit.remote.error") for span in remote_spans] == [
        None,
        None,
    ]
    assert all(
        span.get_attribute("appkit.remote.latency_ms") >= 0 for span in remote_spans
    )
    assert [span.get_attribute("appkit.usage") for span in remote_spans] == [
        {
            "inputTokens": 4,
            "outputTokens": 2,
            "totalTokens": 6,
            "costAvailable": True,
            "costUsd": 0.01,
        },
        {
            "inputTokens": 4,
            "outputTokens": 2,
            "totalTokens": 6,
            "costAvailable": True,
            "costUsd": 0.01,
        },
    ]
    assert [span.get_attribute("appkit.cost_available") for span in remote_spans] == [
        True,
        True,
    ]
    assert [span.get_attribute("appkit.cost_usd") for span in remote_spans] == [
        0.01,
        0.01,
    ]
    continued_trace_id = traceparents[0].split("-")[1]
    assert remote_spans[0].get_attribute("appkit.remote.trace_id") == continued_trace_id
    assert remote_spans[0].get_attribute("appkit.remote.root_span_id") == (
        "1111111111111111"
    )
    assert remote_spans[0].outputs == {
        "output": "response from apps/specialist-app",
        "remoteTraceId": continued_trace_id,
        "remoteRootSpanId": "1111111111111111",
    }
    assert remote_spans[0].get_attribute("appkit.remote.relation") == "continued"
    assert remote_spans[0].links == []
    assert remote_spans[1].get_attribute("appkit.remote.trace_id") == (
        "22222222222222222222222222222222"
    )
    assert remote_spans[1].get_attribute("appkit.remote.root_span_id") == (
        "3333333333333333"
    )
    assert remote_spans[1].outputs == {
        "output": "response from specialist-endpoint",
        "remoteTraceId": "22222222222222222222222222222222",
        "remoteRootSpanId": "3333333333333333",
    }
    assert remote_spans[1].get_attribute("appkit.remote.relation") == "linked"
    assert len(remote_spans[1].links) == 1
    assert remote_spans[1].links[0].span_id == "3333333333333333"
    assert len(model_spans) == 3
    assert all(span.parent_id is not None for span in model_spans + remote_spans)
    assert all(span.trace_id == roots[0].trace_id for span in model_spans + remote_spans)
    assert roots[0].get_attribute("appkit.usage") == {
        "inputTokens": 36,
        "outputTokens": 7,
        "totalTokens": 43,
        "costAvailable": False,
    }
    serialized = json.dumps([span.to_dict() for span in trace.data.spans])
    assert "remote-key" not in serialized


def test_real_runner_failed_remote_has_stable_safe_schema(monkeypatch, tmp_path):
    tracking_uri = f"sqlite:///{tmp_path / 'remote-failure.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "multi-remote-failure", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    local_responses = [
        {
            "id": "chatcmpl-remote-error",
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
                                "id": "call-failing-app",
                                "type": "function",
                                "function": {
                                    "name": "query_app_agent",
                                    "arguments": json.dumps(
                                        {"question": "delegated failure input"}
                                    ),
                                },
                            }
                        ],
                    },
                }
            ],
            "usage": {"prompt_tokens": 7, "completion_tokens": 2, "total_tokens": 9},
        },
        {
            "id": "chatcmpl-after-error",
            "object": "chat.completion",
            "created": 2,
            "model": "databricks-gpt-5-2",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": "Handled failure."},
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13},
        },
    ]

    async def local_transport(request):
        return httpx.Response(200, json=local_responses.pop(0), request=request)

    local_client = AsyncOpenAI(
        api_key="local",
        base_url="https://local.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(local_transport)),
    )

    class FailingResponses:
        async def create(self, **_kwargs):
            raise RuntimeError("authorization Bearer remotefailuresecret")

    remote_client = SimpleNamespace(responses=FailingResponses())
    clients = iter([local_client, remote_client])
    import databricks_openai

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: next(clients))
    set_default_openai_client(local_client)
    from agent_server import agent

    monkeypatch.setattr(agent, "_tool_client", remote_client)
    agent.SUBAGENTS = [
        {
            "name": "app_agent",
            "type": "app",
            "endpoint": "failing-app",
            "description": "Delegate to a failing app.",
        }
    ]
    agent.subagent_tools = [agent._make_subagent_tool(agent.SUBAGENTS[0])]
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "Use the failing specialist."}],
        custom_inputs={"session_id": "failed-remote", "request_id": "failed-remote"},
    )
    response = asyncio.run(agent.invoke_handler(request))
    assert response.output[-1].content[0]["text"] == "Handled failure."

    mlflow.flush_trace_async_logging()
    rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(rows) == 1
    trace = mlflow.get_trace(rows.iloc[0].trace_id)
    remote = next(span for span in trace.data.spans if span.name == "remote.app_agent")
    assert remote.status.status_code == "ERROR"
    assert remote.inputs == {"input": "delegated failure input"}
    assert remote.outputs == {
        "error": "authorization Bearer [REDACTED]"
    }
    for key in ("appkit.remote.trace_id", "appkit.remote.root_span_id"):
        assert key in remote.attributes
        assert remote.get_attribute(key) is None
    assert remote.get_attribute("appkit.remote.relation") == "unverified"
    assert remote.get_attribute("appkit.remote.status") == "ERROR"
    assert remote.get_attribute("appkit.remote.error") == (
        "authorization Bearer [REDACTED]"
    )
    assert remote.get_attribute("appkit.remote.latency_ms") >= 0
    assert remote.get_attribute("appkit.usage") == {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "costAvailable": False,
    }
    assert remote.get_attribute("appkit.cost_available") is False
    assert "appkit.cost_usd" not in remote.attributes
    assert remote.get_attribute("appkit.remote.target_type") == "app"
    assert remote.get_attribute("appkit.remote.target_name") == "failing-app"
    serialized = json.dumps([span.to_dict() for span in trace.data.spans])
    assert "remotefailuresecret" not in serialized


def test_real_runner_genie_handoff_traces_health_and_continuation(
    monkeypatch, tmp_path
):
    tracking_uri = f"sqlite:///{tmp_path / 'genie.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "multi-genie", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    local_responses = [
        {
            "id": "chatcmpl-genie",
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
                                "id": "call-genie",
                                "type": "function",
                                "function": {
                                    "name": "query_genie",
                                    "arguments": json.dumps({"question": "revenue"}),
                                },
                            }
                        ],
                    },
                }
            ],
            "usage": {"prompt_tokens": 8, "completion_tokens": 2, "total_tokens": 10},
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
                    "message": {"role": "assistant", "content": "Genie complete."},
                }
            ],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14},
        },
    ]

    async def transport(request):
        return httpx.Response(200, json=local_responses.pop(0), request=request)

    local_client = AsyncOpenAI(
        api_key="local",
        base_url="https://local.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    final_mcp_metadata = []

    class FakeMcpServer:
        def __init__(self, *, name, **_kwargs):
            self.name = name
            self.cached_tools = None
            self.use_structured_content = False
            self.tool_meta_resolver = None
            self.custom_data_extractor = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        def _get_failure_error_function(self, default):
            return default

        def _get_needs_approval_for_tool(self, _tool, _agent):
            return False

        async def list_tools(self, *_args, **_kwargs):
            return [
                Tool(
                    name="query_genie",
                    description="Query Genie.",
                    inputSchema={
                        "type": "object",
                        "properties": {"question": {"type": "string"}},
                        "required": ["question"],
                    },
                )
            ]

        async def call_tool(self, _tool_name, _arguments, meta=None, **_kwargs):
            final_mcp_metadata.append(dict(meta or {}))
            trace_id = meta["traceparent"].split("-")[1]
            return CallToolResult(
                content=[TextContent(type="text", text="Genie result")],
                _meta={
                    "trace_id": trace_id,
                    "root_span_id": "4444444444444444",
                },
            )

    import databricks_openai
    import databricks_openai.agents

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: local_client)
    monkeypatch.setattr(databricks_openai.agents, "McpServer", FakeMcpServer)
    set_default_openai_client(local_client)
    from agent_server import agent

    monkeypatch.setattr(agent, "build_mcp_url", lambda path: f"https://test.invalid{path}")
    monkeypatch.setattr(agent, "McpServer", FakeMcpServer)
    agent.SUBAGENTS = [
        {
            "name": "genie",
            "type": "genie",
            "space_id": "space-123",
            "description": "Query Genie.",
        }
    ]
    agent.subagent_tools = []
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "Ask Genie."}],
        custom_inputs={
            "session_id": "genie-session",
            "user_id": "genie-user",
            "request_id": "genie-request",
        },
    )
    response = asyncio.run(agent.invoke_handler(request))
    assert response.output[-1].content[0]["text"] == "Genie complete."
    assert len(final_mcp_metadata) == 1
    assert "traceparent" in final_mcp_metadata[0]

    mlflow.flush_trace_async_logging()
    rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(rows) == 1
    trace = mlflow.get_trace(rows.iloc[0].trace_id)
    roots = [span for span in trace.data.spans if span.parent_id is None]
    assert [(span.name, span.span_type) for span in roots] == [
        ("AgentRunner.run", "AGENT")
    ]
    for expected in ("mcp.setup", "mcp.health", "remote.genie"):
        assert len([span for span in trace.data.spans if span.name == expected]) == 1
    remote = next(span for span in trace.data.spans if span.name == "remote.genie")
    assert remote.span_type == "AGENT"
    assert remote.get_attribute("appkit.remote.relation") == "continued"
    assert remote.get_attribute("appkit.remote.root_span_id") == "4444444444444444"
    assert remote.links == []


def test_real_runner_genie_tool_failure_finalizes_safe_schema(monkeypatch, tmp_path):
    tracking_uri = f"sqlite:///{tmp_path / 'genie-failure.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "multi-genie-failure", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)

    local_responses = [
        {
            "id": "chatcmpl-genie-failure",
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
                                "id": "call-genie-failure",
                                "type": "function",
                                "function": {
                                    "name": "query_genie",
                                    "arguments": json.dumps({"question": "revenue"}),
                                },
                            }
                        ],
                    },
                }
            ],
            "usage": {"prompt_tokens": 8, "completion_tokens": 2, "total_tokens": 10},
        },
        {
            "id": "chatcmpl-after-genie-failure",
            "object": "chat.completion",
            "created": 2,
            "model": "databricks-gpt-5-2",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": "Handled Genie failure.",
                    },
                }
            ],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14},
        },
    ]

    async def transport(request):
        return httpx.Response(200, json=local_responses.pop(0), request=request)

    local_client = AsyncOpenAI(
        api_key="local",
        base_url="https://local.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )
    final_mcp_metadata = []

    class FailingMcpServer:
        def __init__(self, *, name, **_kwargs):
            self.name = name
            self.cached_tools = None
            self.use_structured_content = False
            self.tool_meta_resolver = None
            self.custom_data_extractor = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        def _get_failure_error_function(self, default):
            return default

        def _get_needs_approval_for_tool(self, _tool, _agent):
            return False

        async def list_tools(self, *_args, **_kwargs):
            return [
                Tool(
                    name="query_genie",
                    description="Query Genie.",
                    inputSchema={
                        "type": "object",
                        "properties": {"question": {"type": "string"}},
                        "required": ["question"],
                    },
                )
            ]

        async def call_tool(self, _tool_name, _arguments, meta=None, **_kwargs):
            final_mcp_metadata.append(dict(meta or {}))
            raise RuntimeError("token mcptoolfailuresecret")

    import databricks_openai
    import databricks_openai.agents

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: local_client)
    monkeypatch.setattr(databricks_openai.agents, "McpServer", FailingMcpServer)
    set_default_openai_client(local_client)
    from agent_server import agent

    monkeypatch.setattr(agent, "build_mcp_url", lambda path: f"https://test.invalid{path}")
    monkeypatch.setattr(agent, "McpServer", FailingMcpServer)
    agent.SUBAGENTS = [
        {
            "name": "genie",
            "type": "genie",
            "space_id": "space-failure",
            "description": "Query Genie.",
        }
    ]
    agent.subagent_tools = []
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "Ask failing Genie."}],
        custom_inputs={"session_id": "genie-failure", "request_id": "genie-failure"},
    )
    response = asyncio.run(agent.invoke_handler(request))
    assert response.output[-1].content[0]["text"] == "Handled Genie failure."
    assert len(final_mcp_metadata) == 1
    assert "traceparent" in final_mcp_metadata[0]

    mlflow.flush_trace_async_logging()
    rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(rows) == 1
    trace = mlflow.get_trace(rows.iloc[0].trace_id)
    roots = [span for span in trace.data.spans if span.parent_id is None]
    models = [span for span in trace.data.spans if span.span_type == "CHAT_MODEL"]
    assert [(span.name, span.span_type) for span in roots] == [
        ("AgentRunner.run", "AGENT")
    ]
    assert len(models) == 2
    for expected in ("mcp.setup", "mcp.health", "remote.genie"):
        assert len([span for span in trace.data.spans if span.name == expected]) == 1
    remote = next(span for span in trace.data.spans if span.name == "remote.genie")
    assert remote.status.status_code == "ERROR"
    assert remote.inputs == {
        "input": {"tool": "query_genie", "arguments": {"question": "revenue"}}
    }
    assert remote.outputs == {"error": "token [REDACTED]"}
    assert remote.get_attribute("appkit.remote.target_type") == "genie"
    assert remote.get_attribute("appkit.remote.target_name") == "space-failure"
    assert remote.get_attribute("appkit.remote.trace_id") is None
    assert remote.get_attribute("appkit.remote.root_span_id") is None
    assert remote.get_attribute("appkit.remote.relation") == "unverified"
    assert remote.get_attribute("appkit.remote.status") == "ERROR"
    assert remote.get_attribute("appkit.remote.error") == "token [REDACTED]"
    assert remote.get_attribute("appkit.remote.latency_ms") >= 0
    assert remote.get_attribute("appkit.usage") == {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "costAvailable": False,
    }
    assert remote.get_attribute("appkit.cost_available") is False
    assert "appkit.cost_usd" not in remote.attributes
    serialized = json.dumps([span.to_dict() for span in trace.data.spans])
    assert "mcptoolfailuresecret" not in serialized
