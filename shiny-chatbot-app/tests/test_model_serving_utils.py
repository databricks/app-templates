from unittest.mock import patch
import sys
from model_serving_utils import query_endpoint

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
