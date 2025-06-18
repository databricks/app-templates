from unittest.mock import patch, MagicMock
import pytest
from model_serving_utils import (
    query_endpoint, 
    query_endpoint_stream, 
    _get_endpoint_task_type,
    submit_feedback,
    endpoint_supports_feedback
)

@patch("model_serving_utils.get_deploy_client")
@patch("model_serving_utils._get_endpoint_task_type")
def test_query_endpoint_chat_format(mock_task_type, mock_get_client):
    mock_task_type.return_value = "chat/completions"
    mock_client = mock_get_client.return_value
    mock_client.predict.return_value = {
        "choices": [{"message": {"role": "assistant", "content": "Hello!"}}],
        "databricks_output": {"databricks_request_id": "req-123"}
    }

    messages, request_id = query_endpoint("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400, False)
    assert messages == [{"role": "assistant", "content": "Hello!"}]
    assert request_id == "req-123"

@patch("model_serving_utils.get_deploy_client")
@patch("model_serving_utils._get_endpoint_task_type")
def test_query_endpoint_agent_format(mock_task_type, mock_get_client):
    mock_task_type.return_value = "chat/completions"
    mock_client = mock_get_client.return_value
    mock_client.predict.return_value = {
        "messages": [{"role": "assistant", "content": "Agent response."}],
        "databricks_output": {"databricks_request_id": "req-456"}
    }

    messages, request_id = query_endpoint("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400, False)
    assert messages == [{"role": "assistant", "content": "Agent response."}]
    assert request_id == "req-456"

@patch("model_serving_utils.get_deploy_client")
@patch("model_serving_utils._get_endpoint_task_type")
def test_query_endpoint_responses_format(mock_task_type, mock_get_client):
    mock_task_type.return_value = "agent/v1/responses"
    mock_client = mock_get_client.return_value
    
    # Mock the response from MLflow deployments client
    mock_response = {
        "output": [
            {
                "type": "function_call",
                "name": "check_outage_status_tool",
                "call_id": "toolu_bdrk_01S4RiYdghVxDXwYVWsemDXk",
                "arguments": '{"region":"Moscone Center"}'
            },
            {
                "type": "function_call_output",
                "call_id": "toolu_bdrk_01S4RiYdghVxDXwYVWsemDXk",
                "output": '{\n  "timestamp": "2025-06-15T17:17:06.242091Z"\n}'
            },
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": "Yes, there is currently an active outage affecting the Moscone Center area."
                    }
                ]
            }
        ],
        "databricks_output": {"databricks_request_id": "req-789"}
    }
    mock_client.predict.return_value = mock_response

    messages, request_id = query_endpoint("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400, False)
    expected_messages = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": "toolu_bdrk_01S4RiYdghVxDXwYVWsemDXk",
                "type": "function",
                "function": {
                    "name": "check_outage_status_tool",
                    "arguments": '{"region":"Moscone Center"}'
                }
            }]
        },
        {
            "role": "tool",
            "content": '{\n  "timestamp": "2025-06-15T17:17:06.242091Z"\n}',
            "tool_call_id": "toolu_bdrk_01S4RiYdghVxDXwYVWsemDXk"
        },
        {
            "role": "assistant",
            "content": "Yes, there is currently an active outage affecting the Moscone Center area."
        }
    ]
    assert messages == expected_messages
    assert request_id == "req-789"

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

@patch("model_serving_utils.get_deploy_client")
@patch("model_serving_utils._get_endpoint_task_type")
def test_query_endpoint_stream_chat_format(mock_task_type, mock_get_client):
    mock_task_type.return_value = "chat/completions"
    mock_client = mock_get_client.return_value
    mock_client.predict_stream.return_value = [
        {"choices": [{"delta": {"content": "Hello"}}]},
        {"choices": [{"delta": {"content": " world!"}}]}
    ]

    results = list(query_endpoint_stream("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400, False))
    assert len(results) == 2
    assert results[0]["delta"]["content"] == "Hello"
    assert results[1]["delta"]["content"] == " world!"

@patch("model_serving_utils.get_deploy_client")
@patch("model_serving_utils._get_endpoint_task_type")
def test_query_endpoint_stream_agent_format(mock_task_type, mock_get_client):
    mock_task_type.return_value = "chat/completions"
    mock_client = mock_get_client.return_value
    mock_client.predict_stream.return_value = [
        {"delta": {"role": "assistant", "content": "Agent response"}},
    ]

    results = list(query_endpoint_stream("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400, False))
    assert len(results) == 1
    assert results[0]["delta"]["content"] == "Agent response"

@patch("model_serving_utils.get_deploy_client")
@patch("model_serving_utils._get_endpoint_task_type")
def test_query_endpoint_stream_responses_format(mock_task_type, mock_get_client):
    mock_task_type.return_value = "agent/v1/responses"
    mock_client = mock_get_client.return_value
    
    # Mock streaming events from MLflow deployments client
    mock_stream_events = [
        {
            "type": "response.output_text.delta",
            "delta": "Stream ",
            "item_id": "msg-123"
        },
        {
            "type": "response.output_text.delta", 
            "delta": "response",
            "item_id": "msg-123"
        },
        {
            "type": "response.output_item.done",
            "item": {
                "type": "message",
                "id": "msg-123",
                "content": [
                    {
                        "type": "output_text",
                        "text": "Full message content"
                    }
                ]
            }
        }
    ]
    mock_client.predict_stream.return_value = mock_stream_events
    
    results = list(query_endpoint_stream("dummy-endpoint", [{"role": "user", "content": "Hi"}], 400, False))
    assert len(results) == 3
    assert results[0]["delta"]["content"] == "Stream "
    assert results[0]["delta"]["id"] == "msg-123"
    assert results[1]["delta"]["content"] == "response"
    assert results[1]["delta"]["id"] == "msg-123"
    assert results[2]["delta"]["content"] == "Full message content"
    assert results[2]["delta"]["id"] == "msg-123"

@patch("model_serving_utils.WorkspaceClient")
def test_submit_feedback(mock_workspace_client):
    mock_client = MagicMock()
    mock_workspace_client.return_value = mock_client
    mock_client.api_client.do.return_value = {"status": "success"}
    
    result = submit_feedback("test-endpoint", "req-123", 1)
    
    mock_client.api_client.do.assert_called_once()
    call_args = mock_client.api_client.do.call_args
    assert call_args[1]["method"] == "POST"
    assert "feedback" in call_args[1]["path"]

@patch("model_serving_utils.WorkspaceClient")
def test_endpoint_supports_feedback(mock_workspace_client):
    mock_client = MagicMock()
    mock_workspace_client.return_value = mock_client
    
    mock_endpoint = MagicMock()
    mock_entity = MagicMock()
    mock_entity.entity_name = "feedback"
    mock_endpoint.config.served_entities = [mock_entity]
    mock_client.serving_endpoints.get.return_value = mock_endpoint
    
    result = endpoint_supports_feedback("test-endpoint")
    assert result is True

@patch("model_serving_utils.WorkspaceClient")
def test_endpoint_supports_feedback_false(mock_workspace_client):
    mock_client = MagicMock()
    mock_workspace_client.return_value = mock_client
    
    mock_endpoint = MagicMock()
    mock_entity = MagicMock()
    mock_entity.entity_name = "model"
    mock_endpoint.config.served_entities = [mock_entity]
    mock_client.serving_endpoints.get.return_value = mock_endpoint
    
    result = endpoint_supports_feedback("test-endpoint")
    assert result is False