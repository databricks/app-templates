"""Tests for the agent-supervisor-api template.

Unit tests run without credentials. Integration tests require setting
DATABRICKS_HOST and DATABRICKS_TOKEN (or a configured CLI profile).

Integration test target:
  Host: https://eng-ml-inference.staging.cloud.databricks.com
  AI Gateway: https://1653573648247579.ai-gateway.staging.cloud.databricks.com/mlflow/v1/responses
  LiteSwap header: x-databricks-traffic-id: testenv://liteswap/mas-arv
  Model: databricks-claude-opus-4-6
"""
import os
from unittest.mock import MagicMock, patch

import pytest
from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentResponse


# --- Unit tests (no credentials needed) ---


def test_module_imports():
    """Agent module imports cleanly without auth."""
    import agent_server.agent as agent
    assert hasattr(agent, "MODEL")
    assert hasattr(agent, "TOOLS")
    assert hasattr(agent, "invoke_handler")
    assert hasattr(agent, "stream_handler")
    assert hasattr(agent, "_get_client")


def test_ai_gateway_base_url():
    """_ai_gateway_base_url derives the AI Gateway URL from workspace host + workspace ID."""
    from agent_server.agent import _ai_gateway_base_url

    mock_wc = MagicMock()
    mock_wc.config.host = "https://my-workspace.cloud.databricks.com"
    mock_wc.get_workspace_id.return_value = 1234567890

    url = _ai_gateway_base_url(mock_wc)
    assert url == "https://1234567890.ai-gateway.cloud.databricks.com/mlflow/v1"


def test_ai_gateway_base_url_staging():
    """Works for staging workspaces too."""
    from agent_server.agent import _ai_gateway_base_url

    mock_wc = MagicMock()
    mock_wc.config.host = "https://eng-ml-inference.staging.cloud.databricks.com"
    mock_wc.get_workspace_id.return_value = 1653573648247579

    url = _ai_gateway_base_url(mock_wc)
    assert url == "https://1653573648247579.ai-gateway.staging.cloud.databricks.com/mlflow/v1"


def test_get_client_uses_ai_gateway_url():
    """_get_client configures DatabricksOpenAI with the AI Gateway base URL."""
    from agent_server.agent import _get_client

    mock_wc = MagicMock()
    mock_wc.config.host = "https://my-workspace.cloud.databricks.com"
    mock_wc.get_workspace_id.return_value = 1234567890

    captured = {}

    def fake_databricks_openai(**kwargs):
        captured.update(kwargs)
        return MagicMock()

    with patch("agent_server.agent.WorkspaceClient", return_value=mock_wc), \
         patch("agent_server.agent.DatabricksOpenAI", side_effect=fake_databricks_openai):
        _get_client()

    assert captured["base_url"] == "https://1234567890.ai-gateway.cloud.databricks.com/mlflow/v1"
    assert captured["workspace_client"] is mock_wc


def test_tools_structure():
    """TOOLS list has correct structure."""
    from agent_server.agent import TOOLS
    assert len(TOOLS) >= 1
    tool = TOOLS[0]
    assert "type" in tool
    assert tool["type"] in ("uc_function", "genie", "agent_endpoint", "mcp")


def test_model_is_string():
    from agent_server.agent import MODEL
    assert isinstance(MODEL, str)
    assert len(MODEL) > 0


def test_get_session_id_from_conversation_id():
    from agent_server.utils import get_session_id
    req = MagicMock(spec=ResponsesAgentRequest)
    req.context = MagicMock()
    req.context.conversation_id = "conv-123"
    assert get_session_id(req) == "conv-123"


def test_get_session_id_from_custom_inputs():
    from agent_server.utils import get_session_id
    req = MagicMock(spec=ResponsesAgentRequest)
    req.context = None
    req.custom_inputs = {"session_id": "sess-456"}
    assert get_session_id(req) == "sess-456"


def test_get_session_id_returns_none():
    from agent_server.utils import get_session_id
    req = MagicMock(spec=ResponsesAgentRequest)
    req.context = None
    req.custom_inputs = None
    assert get_session_id(req) is None


def test_invoke_handler_calls_responses_create():
    """invoke_handler calls client.responses.create with correct params."""
    from agent_server.agent import MODEL, TOOLS

    mock_item = MagicMock()
    mock_item.model_dump.return_value = {"type": "message", "id": "msg_001", "role": "assistant", "content": [{"type": "output_text", "text": "hi"}]}
    mock_response = MagicMock()
    mock_response.output = [mock_item]

    mock_client = MagicMock()
    mock_client.responses.create.return_value = mock_response

    with patch("agent_server.agent._get_client", return_value=mock_client):
        req = MagicMock(spec=ResponsesAgentRequest)
        req.context = None
        req.custom_inputs = None
        req.input = [MagicMock()]
        req.input[0].model_dump.return_value = {"type": "message", "role": "user", "content": "hi"}

        from agent_server.agent import invoke_handler
        result = invoke_handler(req)

    from agent_server.agent import _EXTRA_HEADERS
    mock_client.responses.create.assert_called_once_with(
        model=MODEL,
        input=[{"type": "message", "role": "user", "content": "hi"}],
        tools=TOOLS,
        stream=False,
        extra_headers=_EXTRA_HEADERS,
    )
    assert isinstance(result, ResponsesAgentResponse)
    assert len(result.output) == 1
    assert result.output[0].id == "msg_001"


def test_stream_handler_calls_responses_create_streaming():
    """stream_handler calls client.responses.create with stream=True."""
    from agent_server.agent import MODEL, TOOLS

    mock_client = MagicMock()
    mock_client.responses.create.return_value = iter([])

    with patch("agent_server.agent._get_client", return_value=mock_client):
        req = MagicMock(spec=ResponsesAgentRequest)
        req.context = None
        req.custom_inputs = None
        req.input = [MagicMock()]
        req.input[0].model_dump.return_value = {"type": "message", "role": "user", "content": "hi"}

        from agent_server.agent import stream_handler
        stream_handler(req)  # Returns the iterator from client

    from agent_server.agent import _EXTRA_HEADERS
    mock_client.responses.create.assert_called_once_with(
        model=MODEL,
        input=[{"type": "message", "role": "user", "content": "hi"}],
        tools=TOOLS,
        stream=True,
        extra_headers=_EXTRA_HEADERS,
    )


# --- Integration tests (require credentials for eng-ml-inference staging) ---


INTEGRATION_REASON = (
    "Integration test requires DATABRICKS_TOKEN and DATABRICKS_HOST for "
    "eng-ml-inference staging (workspace 1653573648247579). "
    "Set ENG_ML_INFERENCE_TOKEN to enable."
)


@pytest.mark.skipif(
    not os.environ.get("ENG_ML_INFERENCE_TOKEN"),
    reason=INTEGRATION_REASON,
)
def test_supervisor_api_basic_call():
    """End-to-end: call the Supervisor API with a simple prompt (no tools)."""
    import openai

    token = os.environ["ENG_ML_INFERENCE_TOKEN"]
    client = openai.OpenAI(
        base_url="https://1653573648247579.ai-gateway.staging.cloud.databricks.com/mlflow/v1",
        api_key=token,
        default_headers={"x-databricks-traffic-id": "testenv://liteswap/mas-arv"},
    )
    response = client.responses.create(
        model="databricks-claude-opus-4-6",
        input=[{"type": "message", "role": "user", "content": "Reply with just the word 'OK'."}],
    )
    assert response.output_text.strip() != ""


@pytest.mark.skipif(
    not os.environ.get("ENG_ML_INFERENCE_TOKEN"),
    reason=INTEGRATION_REASON,
)
def test_supervisor_api_with_genie_tool():
    """End-to-end: call Supervisor API with Genie tool (the NYC taxi example)."""
    import openai

    token = os.environ["ENG_ML_INFERENCE_TOKEN"]
    client = openai.OpenAI(
        base_url="https://1653573648247579.ai-gateway.staging.cloud.databricks.com/mlflow/v1",
        api_key=token,
        default_headers={"x-databricks-traffic-id": "testenv://liteswap/mas-arv"},
    )
    response = client.responses.create(
        model="databricks-claude-opus-4-6",
        input=[
            {
                "type": "message",
                "role": "user",
                "content": "What zipcodes do the taxis operate in?",
            }
        ],
        tools=[
            {
                "type": "genie",
                "genie": {
                    "name": "nyc-taxi-space",
                    "description": "Information about NYC Taxi spaces",
                    "space_id": "01f07892cf3118edad0a4054bcd25122",
                },
            }
        ],
    )
    assert response.output_text.strip() != ""
