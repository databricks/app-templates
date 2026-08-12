from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx
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
    final_wire_headers = []

    class RemoteResponses:
        async def create(self, *, model, input, extra_headers=None, **_kwargs):
            headers = {"authorization": "Bearer remote-key", **(extra_headers or {})}
            final_wire_headers.append({key.lower(): value for key, value in headers.items()})
            traceparent = headers.get("traceparent")
            if model == "apps/specialist-app" and traceparent:
                remote_trace_id = traceparent.split("-")[1]
                remote_span_id = "1111111111111111"
            else:
                remote_trace_id = "22222222222222222222222222222222"
                remote_span_id = "3333333333333333"
            return SimpleNamespace(
                output_text=f"response from {model}",
                trace_id=remote_trace_id,
                root_span_id=remote_span_id,
                usage=SimpleNamespace(
                    input_tokens=4, output_tokens=2, total_tokens=6, cost_usd=0.01
                ),
            )

    remote_client = SimpleNamespace(responses=RemoteResponses())
    clients = iter([local_client, remote_client])
    import databricks_openai

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: next(clients))
    set_default_openai_client(local_client)
    from agent_server import agent

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
    assert len(final_wire_headers) == 2
    assert all(headers["authorization"] == "Bearer remote-key" for headers in final_wire_headers)
    assert all("traceparent" in headers for headers in final_wire_headers)

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
    assert [(span.name, span.span_type) for span in roots] == [
        ("AgentRunner.run", "AGENT")
    ]
    assert [span.name for span in remote_spans] == [
        "remote.app_agent",
        "remote.serving_endpoint",
    ]
    assert remote_spans[0].get_attribute("appkit.remote.relation") == "continued"
    assert remote_spans[0].links == []
    assert remote_spans[1].get_attribute("appkit.remote.relation") == "linked"
    assert len(remote_spans[1].links) == 1
    assert remote_spans[1].links[0].span_id == "3333333333333333"
    assert roots[0].get_attribute("appkit.usage") == {
        "inputTokens": 36,
        "outputTokens": 7,
        "totalTokens": 43,
        "costAvailable": False,
    }


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
