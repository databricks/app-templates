import re
from types import SimpleNamespace
from typing import get_args
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from agents import OpenAIChatCompletionsModel

from agent.agent import (
    EFFORTS,
    configure,
    instructions,
    run_agent,
)
from agent.context import RequestContext
from agent.gateway import GatewayCompletions
from agent.models import Effort, Reasoning
from agent.prompts import prompt
from agent.settings import settings
from agent.tools import Step
from tests.conftest import DEFAULT_MODEL, build_agent


@pytest.fixture(autouse=True)
def fresh_settings():
    settings.cache_clear()
    yield
    settings.cache_clear()


def test_the_model_runs_through_the_model_service_as_the_user():
    modes: list[str] = []

    agent = build_agent(modes)

    assert isinstance(agent.model, OpenAIChatCompletionsModel)
    assert agent.model.model == "test_catalog.test_ops.sonnet_llm"
    assert str(agent.model._client.base_url) == (
        "https://workspace.example.com/ai-gateway/mlflow/v1/"
    )
    assert agent.model_settings.extra_body == {"thinking": {"type": "between_tools"}}
    assert isinstance(agent.model._client.chat.completions, GatewayCompletions)
    assert modes == ["user"]


def test_every_reasoning_style_has_settings_for_every_effort():
    assert set(EFFORTS) == set(get_args(Reasoning))
    for efforts in EFFORTS.values():
        assert set(efforts) == set(get_args(Effort))


def test_every_tool_asks_the_model_for_a_step_label():
    for tool in build_agent([]).tools:
        schema = tool.params_json_schema

        assert "step" in schema["required"], tool.name
        assert schema["properties"]["step"]["description"] == (
            get_args(Step)[1].description
        ), tool.name


def test_the_agent_gets_the_system_prompt_file():
    assert build_agent([]).instructions == prompt("system")


def test_the_prompt_has_no_placeholders():
    assert not re.search(r"[{}<>\[\]]|TODO|TBD|XXX|\.\.\.", instructions())


def test_configure_requires_app_catalog(monkeypatch):
    monkeypatch.delenv("APP_CATALOG", raising=False)
    settings.cache_clear()

    with pytest.raises(KeyError, match="APP_CATALOG"):
        configure()


def test_configure_refuses_to_start_with_both_app_name_and_local_runtime_store(
    monkeypatch,
):
    monkeypatch.setenv("DATABRICKS_APP_NAME", "agent-bricks-agent")
    monkeypatch.setenv("DATABRICKS_AGENTBRICKS_RUNTIME_STORE_LOCAL", "true")
    settings.cache_clear()

    with pytest.raises(
        ValueError,
        match="DATABRICKS_APP_NAME.*DATABRICKS_AGENTBRICKS_RUNTIME_STORE_LOCAL",
    ):
        configure()

    settings.cache_clear()


@pytest.mark.asyncio
async def test_run_agent_closes_the_model_client_after_a_run():
    def client_for(mode: str) -> SimpleNamespace:
        user_client = SimpleNamespace(
            config=SimpleNamespace(
                host="https://workspace.example.com",
                authenticate=lambda: {"Authorization": "Bearer user-token"},
            ),
            current_user=MagicMock(
                me=MagicMock(return_value=SimpleNamespace(user_name="test_user"))
            ),
        )
        return user_client

    async def emit(event: dict) -> int:
        return 0

    mock_result = AsyncMock()
    mock_result.is_complete = True
    mock_result.stream_events = AsyncMock(
        return_value=AsyncMock(
            __aiter__=AsyncMock(
                return_value=AsyncMock(
                    __anext__=AsyncMock(side_effect=StopAsyncIteration)
                )
            )
        )
    )

    mock_client = AsyncMock()
    mock_client.close = AsyncMock()

    request = RequestContext(client_for, emit, "session-a", "run-1")

    with patch("agent.agent.Runner.run_streamed", return_value=mock_result):
        with patch("agent.agent.GatewayOpenAI", return_value=mock_client):
            async with run_agent(
                [], request=request, model=DEFAULT_MODEL, effort="low"
            ):
                pass

    mock_client.close.assert_called_once()


@pytest.mark.asyncio
async def test_run_agent_closes_the_model_client_even_when_run_fails():
    def client_for(mode: str) -> SimpleNamespace:
        user_client = SimpleNamespace(
            config=SimpleNamespace(
                host="https://workspace.example.com",
                authenticate=lambda: {"Authorization": "Bearer user-token"},
            ),
            current_user=MagicMock(
                me=MagicMock(return_value=SimpleNamespace(user_name="test_user"))
            ),
        )
        return user_client

    async def emit(event: dict) -> int:
        return 0

    mock_result = AsyncMock()
    mock_result.is_complete = False
    mock_result.cancel = AsyncMock()
    mock_result.stream_events = AsyncMock(
        return_value=AsyncMock(
            __aiter__=AsyncMock(
                return_value=AsyncMock(
                    __anext__=AsyncMock(side_effect=StopAsyncIteration)
                )
            )
        )
    )

    mock_client = AsyncMock()
    mock_client.close = AsyncMock()

    request = RequestContext(client_for, emit, "session-b", "run-1")

    with patch("agent.agent.Runner.run_streamed", return_value=mock_result):
        with patch("agent.agent.GatewayOpenAI", return_value=mock_client):
            async with run_agent(
                [], request=request, model=DEFAULT_MODEL, effort="low"
            ):
                pass

    mock_client.close.assert_called_once()
