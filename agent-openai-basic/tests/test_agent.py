"""Smoke tests for the agent.

Hermetic tests import only the leaf packages (tools, sessions, wire) — no Databricks auth needed,
so they run anywhere, including in `databricks agent test`. The live test imports the full agent
(which constructs a Databricks client at import time) and calls the model; it is skipped unless a
workspace profile is configured.
"""

import os

import pytest
from agents.tool import FunctionTool
from mlflow.types.responses import ResponsesAgentRequest

from agent.mason.session_store import create_session
from agent.mason.wire.inbound import get_session_id
from agent.tools import all_tools


def test_tools_autoregister():
    tools = all_tools()
    assert tools, "expected the sample tool to auto-register"
    assert all(isinstance(t, FunctionTool) for t in tools)
    assert "get_current_time" in {t.name for t in tools}


def test_session_defaults_to_sqlite():
    session = create_session("test-session")
    assert session.session_id == "test-session"
    # The local default needs no database; SQLite-backed session exposes this coroutine.
    assert hasattr(session, "get_items")


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
    from agents import Runner

    from agent.agent import configure, create_agent

    configure()  # wire up the Databricks client (needs the workspace auth gated on above)
    result = await Runner.run(create_agent(), "Reply with the single word: pong")
    assert result.final_output
