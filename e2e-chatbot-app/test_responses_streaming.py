import pytest
from unittest.mock import Mock, patch, MagicMock
from messages import AssistantResponse
import app


def test_handle_responses_streaming_basic_message():
    """Test parsing a basic message response using MLflow types."""
    # Mock the dependencies
    with patch('app.st') as mock_st, \
         patch('app.query_endpoint_stream') as mock_stream, \
         patch.object(app, 'SERVING_ENDPOINT', 'test-endpoint'), \
         patch.object(app, 'ENDPOINT_SUPPORTS_FEEDBACK', True):
        
        # Set up mock for streamlit
        mock_chat_message = MagicMock()
        mock_response_area = MagicMock()
        mock_st.chat_message.return_value.__enter__.return_value = mock_chat_message
        mock_st.empty.return_value = mock_response_area
        
        # Mock streaming events - basic message
        mock_events = [
            {
                'type': 'response.output_item.done',
                'item': {
                    'role': 'assistant',
                    'type': 'message',
                    'id': '9dbae6e1-5eb8-49dd-a867-f945e6430323',
                    'content': [
                        {
                            'type': 'output_text',
                            'text': "Hello! How can I help you today?"
                        }
                    ]
                },
                'id': 'e24ce56d-95bc-4d1a-b883-27d054e9cc34',
                'databricks_output': {
                    'databricks_request_id': 'test-request-123'
                }
            }
        ]
        mock_stream.return_value = iter(mock_events)
        
        # Test the function
        handle_responses_streaming = app.handle_responses_streaming
        
        result = handle_responses_streaming([{"role": "user", "content": "Hello"}])
        
        # Verify the result
        assert isinstance(result, AssistantResponse)
        assert result.request_id == 'test-request-123'
        assert len(result.messages) == 1
        assert result.messages[0]['role'] == 'assistant'
        assert result.messages[0]['content'] == "Hello! How can I help you today?"


def test_handle_responses_streaming_with_function_call():
    """Test parsing function call and response using MLflow types."""
    with patch('app.st') as mock_st, \
         patch('app.query_endpoint_stream') as mock_stream, \
         patch.object(app, 'SERVING_ENDPOINT', 'test-endpoint'), \
         patch.object(app, 'ENDPOINT_SUPPORTS_FEEDBACK', True):
        
        # Set up mock for streamlit
        mock_chat_message = MagicMock()
        mock_response_area = MagicMock()
        mock_st.chat_message.return_value.__enter__.return_value = mock_chat_message
        mock_st.empty.return_value = mock_response_area
        
        # Mock streaming events - function call and output
        mock_events = [
            {
                'type': 'response.output_item.done',
                'item': {
                    'type': 'function_call',
                    'id': 'func-call-123',
                    'call_id': 'call-123',
                    'name': 'python_exec',
                    'arguments': '{"code": "print(\'Hello World\')"}'
                },
                'databricks_output': {
                    'databricks_request_id': 'test-request-456'
                }
            },
            {
                'type': 'response.output_item.done',
                'item': {
                    'type': 'function_call_output',
                    'call_id': 'call-123',
                    'output': 'Hello World\n'
                }
            },
            {
                'type': 'response.output_item.done',
                'item': {
                    'role': 'assistant',
                    'type': 'message',
                    'id': 'msg-123',
                    'content': [
                        {
                            'type': 'output_text',
                            'text': "I executed the Python code successfully!"
                        }
                    ]
                }
            }
        ]
        mock_stream.return_value = iter(mock_events)
        
        # Test the function
        handle_responses_streaming = app.handle_responses_streaming
        
        result = handle_responses_streaming([{"role": "user", "content": "Run some Python code"}])
        
        # Verify the result
        assert isinstance(result, AssistantResponse)
        assert result.request_id == 'test-request-456'
        assert len(result.messages) == 3
        
        # Check function call message
        assert result.messages[0]['role'] == 'assistant'
        assert result.messages[0]['content'] == ''
        assert len(result.messages[0]['tool_calls']) == 1
        assert result.messages[0]['tool_calls'][0]['function']['name'] == 'python_exec'
        
        # Check tool response message
        assert result.messages[1]['role'] == 'tool'
        assert result.messages[1]['content'] == 'Hello World\n'
        assert result.messages[1]['tool_call_id'] == 'call-123'
        
        # Check final assistant message
        assert result.messages[2]['role'] == 'assistant'
        assert result.messages[2]['content'] == 'I executed the Python code successfully!'


def test_handle_responses_streaming_mixed_events():
    """Test handling multiple different event types in sequence."""
    with patch('app.st') as mock_st, \
         patch('app.query_endpoint_stream') as mock_stream, \
         patch.object(app, 'SERVING_ENDPOINT', 'test-endpoint'), \
         patch.object(app, 'ENDPOINT_SUPPORTS_FEEDBACK', True):
        
        # Set up mock for streamlit
        mock_chat_message = MagicMock()
        mock_response_area = MagicMock()
        mock_st.chat_message.return_value.__enter__.return_value = mock_chat_message
        mock_st.empty.return_value = mock_response_area
        
        # Mock events with just basic messages
        mock_events = [
            {
                'type': 'response.output_item.done',
                'item': {
                    'type': 'message',
                    'role': 'assistant',
                    'id': 'msg-1',
                    'content': [
                        {
                            'type': 'output_text',
                            'text': "First message"
                        }
                    ]
                },
                'databricks_output': {
                    'databricks_request_id': 'test-request-mixed'
                }
            },
            {
                'type': 'response.output_item.done',
                'item': {
                    'type': 'message',
                    'role': 'assistant', 
                    'id': 'msg-2',
                    'content': [
                        {
                            'type': 'output_text',
                            'text': "Second message"
                        }
                    ]
                }
            }
        ]
        mock_stream.return_value = iter(mock_events)
        
        # Test the function
        handle_responses_streaming = app.handle_responses_streaming
        
        result = handle_responses_streaming([{"role": "user", "content": "Test"}])
        
        # Verify the result 
        assert isinstance(result, AssistantResponse)
        assert result.request_id == 'test-request-mixed'
        assert len(result.messages) == 2
        assert result.messages[0]['content'] == "First message"
        assert result.messages[1]['content'] == "Second message"


def test_handle_responses_streaming_error_handling():
    """Test error handling when streaming fails completely."""
    with patch('app.st') as mock_st, \
         patch('app.query_endpoint_stream') as mock_stream, \
         patch('app.query_endpoint') as mock_query, \
         patch.object(app, 'SERVING_ENDPOINT', 'test-endpoint'), \
         patch.object(app, 'ENDPOINT_SUPPORTS_FEEDBACK', True):
        
        # Set up mock for streamlit
        mock_chat_message = MagicMock()
        mock_response_area = MagicMock()
        mock_st.chat_message.return_value.__enter__.return_value = mock_chat_message
        mock_st.empty.return_value = mock_response_area
        
        # Make streaming fail
        mock_stream.side_effect = Exception("Streaming failed")
        
        # Mock the fallback query_endpoint
        mock_query.return_value = (
            [{"role": "assistant", "content": "Fallback response"}],
            "fallback-request-id"
        )
        
        # Test the function
        handle_responses_streaming = app.handle_responses_streaming
        
        result = handle_responses_streaming([{"role": "user", "content": "Test"}])
        
        # Verify fallback was used
        assert isinstance(result, AssistantResponse)
        assert result.request_id == "fallback-request-id"
        assert result.messages == [{"role": "assistant", "content": "Fallback response"}]
        
        # Verify error message was shown
        mock_response_area.markdown.assert_called_with("_Ran into an error. Retrying without streaming..._")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])