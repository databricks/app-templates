"""Smoke tests for the agent.

Hermetic tests import only the leaf modules (tools, session store, wire) — no Databricks auth
needed, so they run anywhere, including in `databricks agent test`. The live test builds the full
agent and calls the model; it is skipped unless a workspace profile is configured.
"""

import os

import pytest
from langchain_core.tools import BaseTool
from mlflow.types.responses import ResponsesAgentRequest

from agent.mason.session_store import checkpointer, thread_config
from agent.mason.wire.inbound import get_session_id
from agent.tools import all_tools


def test_tools_autoregister():
    tools = all_tools()
    assert tools, "expected the sample tool to auto-register"
    assert all(isinstance(t, BaseTool) for t in tools)
    assert "get_current_time" in {t.name for t in tools}


def test_thread_config_from_session_id():
    assert thread_config("abc-123") == {"configurable": {"thread_id": "abc-123"}}


def test_checkpointer_is_shared():
    # Cached so multi-turn history is preserved in-process across requests.
    assert checkpointer() is checkpointer()


def test_session_id_from_custom_inputs():
    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": "hi"}],
        custom_inputs={"session_id": "abc-123"},
    )
    assert get_session_id(request) == "abc-123"


def test_session_id_generated_when_absent():
    request = ResponsesAgentRequest(input=[{"role": "user", "content": "hi"}])
    generated = get_session_id(request)
    assert generated and generated != get_session_id(
        ResponsesAgentRequest(input=[{"role": "user", "content": "hi"}])
    )


def _has_workspace_auth() -> bool:
    return bool(
        os.getenv("DATABRICKS_CONFIG_PROFILE")
        or (os.getenv("DATABRICKS_HOST") and os.getenv("DATABRICKS_TOKEN"))
    )


@pytest.mark.skipif(
    not _has_workspace_auth(),
    reason="no Databricks profile configured; skipping live model call",
)
@pytest.mark.asyncio
async def test_agent_responds_end_to_end():
    from agent.agent import configure, create_agent_graph

    configure()
    agent = await create_agent_graph()
    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": "Reply with the single word: pong"}]},
        config=thread_config("test-e2e"),
    )
    assert result["messages"][-1].content
