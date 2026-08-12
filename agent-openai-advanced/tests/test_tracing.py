from __future__ import annotations

import asyncio

import httpx
import mlflow
from agents import set_default_openai_client
from openai import AsyncOpenAI
from mlflow.types.responses import ResponsesAgentRequest


def test_real_runner_traces_memory_read_and_write(monkeypatch, tmp_path):
    tracking_uri = f"sqlite:///{tmp_path / 'advanced.db'}"
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    mlflow.set_tracking_uri(tracking_uri)
    experiment_id = mlflow.create_experiment(
        "advanced-memory", artifact_location=artifact_dir.as_uri()
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    monkeypatch.setenv("MLFLOW_TRACKING_URI", tracking_uri)
    monkeypatch.setenv("MLFLOW_EXPERIMENT_ID", experiment_id)
    monkeypatch.setenv("LAKEBASE_AUTOSCALING_ENDPOINT", "test-endpoint")

    response_body = {
        "id": "chatcmpl-memory",
        "object": "chat.completion",
        "created": 1,
        "model": "databricks-gpt-5-2",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "Memory persisted."},
            }
        ],
        "usage": {
            "prompt_tokens": 9,
            "completion_tokens": 3,
            "total_tokens": 12,
        },
    }

    async def transport(request):
        return httpx.Response(200, json=response_body, request=request)

    client = AsyncOpenAI(
        api_key="test",
        base_url="https://example.invalid/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )

    class FakeSession:
        def __init__(self, *, session_id, **_kwargs):
            self.session_id = session_id
            self.items = []

        async def get_items(self, *args, **kwargs):
            return list(self.items)

        async def add_items(self, items):
            self.items.extend(items)

        async def pop_item(self):
            return self.items.pop() if self.items else None

        async def clear_session(self):
            self.items.clear()

    import databricks_openai
    import databricks_openai.agents

    monkeypatch.setattr(databricks_openai, "AsyncDatabricksOpenAI", lambda: client)
    monkeypatch.setattr(databricks_openai.agents, "AsyncDatabricksSession", FakeSession)
    set_default_openai_client(client)

    from agent_server import agent

    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "Remember this."}],
        custom_inputs={
            "session_id": "memory-session",
            "user_id": "memory-user",
            "request_id": "memory-request",
        },
    )
    response = asyncio.run(agent.invoke_handler(request))
    assert response.output[-1].content[0]["text"] == "Memory persisted."

    mlflow.flush_trace_async_logging()
    rows = mlflow.search_traces(experiment_ids=[experiment_id])
    assert len(rows) == 1
    trace = mlflow.get_trace(rows.iloc[0].trace_id)
    roots = [span for span in trace.data.spans if span.parent_id is None]
    memory_spans = [span for span in trace.data.spans if span.span_type == "MEMORY"]
    assert [(span.name, span.span_type) for span in roots] == [
        ("AgentRunner.run", "AGENT")
    ]
    assert [(span.name, span.status.status_code) for span in memory_spans] == [
        ("memory.read", "OK"),
        ("memory.write", "OK"),
        ("memory.write", "OK"),
    ]
    by_id = {span.span_id: span for span in trace.data.spans}

    def descends_from_root(span):
        while span.parent_id is not None:
            if span.parent_id == roots[0].span_id:
                return True
            span = by_id[span.parent_id]
        return False

    assert all(descends_from_root(span) for span in memory_spans)
    assert roots[0].get_attribute("appkit.usage") == {
        "inputTokens": 9,
        "outputTokens": 3,
        "totalTokens": 12,
        "costAvailable": False,
    }
