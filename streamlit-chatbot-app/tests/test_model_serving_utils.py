from unittest.mock import patch, MagicMock
import sys
from model_serving_utils import query_endpoint, _get_endpoint_task_type, query_endpoint_stream

@patch("model_serving_utils.get_deploy_client")
def test_query_endpoint_chat_format(mock_get_client):
    # Arrange
    mock_client = mock_get_client.return_value
    mock_client.predict.return_value = {
        "choices": [{"message": {"role": "assistant", "content": "Hello there!"}}]
    }

    result = query_endpoint("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400)
    assert result == {"role": "assistant", "content": "Hello there!"}

@patch("model_serving_utils.get_deploy_client")
def test_query_endpoint_agent_format(mock_get_client):
    mock_client = mock_get_client.return_value
    mock_client.predict.return_value = {
        "messages": [{"role": "tool", "content": "some tool call res"}, {"role": "assistant", "content": "Agent response."}]
    }

    result = query_endpoint("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400)
    assert result == {"role": "assistant", "content": "Agent response."}

@patch("model_serving_utils._get_endpoint_task_type")
@patch("model_serving_utils.get_deploy_client")
def test_query_endpoint_responses_format(mock_get_client, mock_task_type):
    mock_task_type.return_value = "agent/v1/responses"
    mock_client = mock_get_client.return_value
    mock_client.predict.return_value = {
        "object": "response",
        "output": [
            {
                "name": "check_outage_status_tool",
                "id": "898f8160-0f6b-4163-9e38-9c09e69672de",
                "type": "function_call",
                "call_id": "toolu_bdrk_01S4RiYdghVxDXwYVWsemDXk",
                "arguments": "{\"region\":\"Moscone Center\"}"
            },
            {
                "type": "function_call_output",
                "call_id": "toolu_bdrk_01S4RiYdghVxDXwYVWsemDXk",
                "output": "{\n  \"timestamp\": \"2025-06-15T17:17:06.242091Z\"\n}"
            },
            {
                "type": "message",
                "role": "assistant",
                "id": "7d8484a0-69a9-4d1c-b235-972fd3d0880f",
                "content": [
                    {
                        "type": "output_text",
                        "text": "Yes, there is currently an active outage that may be affecting the Moscone Center area."
                    }
                ]
            }
        ]
    }

    result = query_endpoint("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400)
    assert result == {"role": "assistant", "content": "Yes, there is currently an active outage that may be affecting the Moscone Center area."}

@patch("model_serving_utils.WorkspaceClient")
def test_get_endpoint_task_type(mock_workspace_client):
    mock_client = MagicMock()
    mock_workspace_client.return_value = mock_client
    mock_endpoint = MagicMock()
    mock_endpoint.task = "agent/v1/responses"
    mock_client.serving_endpoints.get.return_value = mock_endpoint
    
    result = _get_endpoint_task_type("test-endpoint")
    assert result == "agent/v1/responses"

@patch("model_serving_utils.WorkspaceClient")
def test_get_endpoint_task_type_fallback(mock_workspace_client):
    mock_workspace_client.side_effect = Exception("API error")
    
    result = _get_endpoint_task_type("test-endpoint")
    assert result == "chat/completions"


@patch("model_serving_utils._get_endpoint_task_type")
@patch("model_serving_utils.query_endpoint")
def test_query_endpoint_stream_fallback(mock_query_endpoint, mock_task_type):
    mock_task_type.return_value = "chat/completions"
    mock_query_endpoint.return_value = {"role": "assistant", "content": "Fallback response"}
    
    result = list(query_endpoint_stream("test-endpoint", [{"role": "user", "content": "Hi"}], 400))
    assert result == ["Fallback response"]
