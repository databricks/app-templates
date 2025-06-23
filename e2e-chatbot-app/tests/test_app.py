import pytest
from unittest.mock import MagicMock
from mlflow.types.agent import ChatAgentChunk, ToolCall
from mlflow.types.chat import Function
from app import reduce_chunks, get_input_messages_for_endpoint
from messages import UserMessage, AssistantResponse


def test_reduce_chunks_basic_content():
    """Test reduce_chunks with basic content chunks."""
    chunks = [
        ChatAgentChunk(delta={"role": "assistant", "content": "Hello ", "id": "msg-1"}),
        ChatAgentChunk(delta={"role": "assistant", "content": "world!", "id": "msg-1"})
    ]
    
    result = reduce_chunks(chunks)
    assert result.content == "Hello world!"
    assert result.role == "assistant"
    assert result.id == "msg-1"


def test_reduce_chunks_with_tool_calls_dict_format():
    """Test reduce_chunks with tool calls in dictionary format."""
    chunks = [
        ChatAgentChunk(delta={
            "role": "assistant", 
            "content": "", 
            "id": "msg-1",
            "tool_calls": [{
                "id": "call-123",
                "type": "function",
                "function": {
                    "name": "test_function",
                    "arguments": '{"arg1":'
                }
            }]
        }),
        ChatAgentChunk(delta={
            "role": "assistant", 
            "content": "", 
            "id": "msg-1",
            "tool_calls": [{
                "id": "call-123",
                "type": "function",
                "function": {
                    "name": "test_function",
                    "arguments": ' "value1"}'
                }
            }]
        })
    ]
    
    result = reduce_chunks(chunks)
    assert result.content == ""
    assert result.role == "assistant"
    assert result.id == "msg-1"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0]["id"] == "call-123"
    assert result.tool_calls[0]["function"]["name"] == "test_function"
    assert result.tool_calls[0]["function"]["arguments"] == '{"arg1": "value1"}'


def test_reduce_chunks_with_tool_calls_object_format():
    """Test reduce_chunks with tool calls in Pydantic object format."""
    # Create proper ToolCall object
    tool_call = ToolCall(
        id="call-456",
        type="function",
        function=Function(
            name="check_status",
            arguments='{"region": "SF"}'
        )
    )
    
    chunks = [
        ChatAgentChunk(delta={
            "role": "assistant", 
            "content": "", 
            "id": "msg-2",
            "tool_calls": [tool_call]
        })
    ]
    
    result = reduce_chunks(chunks)
    assert result.content == ""
    assert result.role == "assistant"
    assert result.id == "msg-2"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0]["id"] == "call-456"
    assert result.tool_calls[0]["function"]["name"] == "check_status"
    assert result.tool_calls[0]["function"]["arguments"] == '{"region": "SF"}'


def test_reduce_chunks_with_tool_call_id():
    """Test reduce_chunks with tool call ID (for tool response messages)."""
    chunks = [
        ChatAgentChunk(delta={
            "role": "tool",
            "name": "test_tool",
            "content": "Tool response",
            "id": "msg-3",
            "tool_call_id": "call-789"
        })
    ]
    
    result = reduce_chunks(chunks)
    assert result.content == "Tool response"
    assert result.role == "tool"
    assert result.id == "msg-3"
    assert result.tool_call_id == "call-789"


def test_reduce_chunks_mixed_content_and_tool_calls():
    """Test reduce_chunks with both content and tool calls."""
    chunks = [
        ChatAgentChunk(delta={
            "role": "assistant", 
            "content": "I'll help with that. ", 
            "id": "msg-4"
        }),
        ChatAgentChunk(delta={
            "role": "assistant", 
            "content": "", 
            "id": "msg-4",
            "tool_calls": [{
                "id": "call-999",
                "type": "function",
                "function": {
                    "name": "helper_function",
                    "arguments": '{}'
                }
            }]
        })
    ]
    
    result = reduce_chunks(chunks)
    assert result.content == "I'll help with that. "
    assert result.role == "assistant"
    assert result.id == "msg-4"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0]["id"] == "call-999"


def test_reduce_chunks_empty_chunks():
    """Test reduce_chunks with empty chunks list."""
    chunks = []
    
    with pytest.raises(IndexError):
        reduce_chunks(chunks)


def test_reduce_chunks_single_chunk():
    """Test reduce_chunks with single chunk."""
    chunks = [
        ChatAgentChunk(delta={"role": "assistant", "content": "Single message", "id": "msg-5"})
    ]
    
    result = reduce_chunks(chunks)
    assert result.content == "Single message"
    assert result.role == "assistant"
    assert result.id == "msg-5"


def test_get_input_messages_for_endpoint_responses_format():
    """Test input message conversion for ResponsesAgent format."""
    history = [
        UserMessage(content="Hello"),
        AssistantResponse(messages=[
            {"role": "assistant", "content": "Hi there!"}
        ], request_id="123"),
        UserMessage(content="What's the weather?"),
        AssistantResponse(messages=[
            {"role": "assistant", "content": "", "tool_calls": [{"id": "call-1", "function": {"name": "get_weather", "arguments": "{}"}}]},
            {"role": "tool", "content": "Sunny", "tool_call_id": "call-1"},
            {"role": "assistant", "content": "It's sunny!"}
        ], request_id="456")
    ]
    
    result = get_input_messages_for_endpoint(history, "agent/v1/responses")
    
    # ResponsesAgent format includes rich conversation history with tool calls
    expected = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
        {"role": "user", "content": "What's the weather?"},
        {"role": "assistant", "content": ""},
        {"role": "tool", "content": "Sunny", "tool_call_id": "call-1"},
        {"role": "assistant", "content": "It's sunny!"}
    ]
    
    assert result == expected


def test_get_input_messages_for_endpoint_chat_format():
    """Test input message conversion for ChatCompletions/ChatAgent format."""
    history = [
        UserMessage(content="Hello"),
        AssistantResponse(messages=[
            {"role": "assistant", "content": "Hi there!"}
        ], request_id="123")
    ]
    
    result = get_input_messages_for_endpoint(history, "chat/completions")
    
    expected = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"}
    ]
    
    assert result == expected


def test_get_input_messages_for_endpoint_responses_context_preservation():
    """Test that ResponsesAgent format preserves conversation context with full history."""
    history = [
        UserMessage(content="What's the 100th Fibonacci number?"),
        AssistantResponse(messages=[
            {"role": "assistant", "content": "", "tool_calls": [{"id": "call-1", "function": {"name": "fibonacci", "arguments": '{"n": 100}'}}]},
            {"role": "tool", "content": "354224848179261915075", "tool_call_id": "call-1"},
            {"role": "assistant", "content": "The 100th Fibonacci number is 354,224,848,179,261,915,075."}
        ], request_id="123"),
        UserMessage(content="What about the 50th?")
    ]
    
    result = get_input_messages_for_endpoint(history, "agent/v1/responses")
    
    # Full conversation history preserves all context including tool calls
    expected = [
        {"role": "user", "content": "What's the 100th Fibonacci number?"},
        {"role": "assistant", "content": ""},  # Tool call message
        {"role": "tool", "content": "354224848179261915075", "tool_call_id": "call-1"},
        {"role": "assistant", "content": "The 100th Fibonacci number is 354,224,848,179,261,915,075."},
        {"role": "user", "content": "What about the 50th?"}
    ]
    
    assert result == expected


def test_multi_turn_conversation_context_preservation():
    """Test that conversation context is properly preserved across multiple turns."""
    # Simulate a multi-turn conversation like the Fibonacci example
    history = [
        # Turn 1: User asks about 100th Fibonacci
        UserMessage(content="What's the 100th Fibonacci number?"),
        AssistantResponse(messages=[
            {"role": "assistant", "content": "", "tool_calls": [{"id": "call-1", "function": {"name": "fibonacci_calc", "arguments": '{"n": 100}'}}]},
            {"role": "tool", "content": "354224848179261915075", "tool_call_id": "call-1"},
            {"role": "assistant", "content": "The 100th Fibonacci number is 354,224,848,179,261,915,075."}
        ], request_id="req-1"),
        
        # Turn 2: User asks about 50th (should have context from previous turn)
        UserMessage(content="What about the 50th?"),
        AssistantResponse(messages=[
            {"role": "assistant", "content": "", "tool_calls": [{"id": "call-2", "function": {"name": "fibonacci_calc", "arguments": '{"n": 50}'}}]},
            {"role": "tool", "content": "12586269025", "tool_call_id": "call-2"},
            {"role": "assistant", "content": "The 50th Fibonacci number is 12,586,269,025."}
        ], request_id="req-2"),
        
        # Turn 3: User asks follow-up question
        UserMessage(content="Which one is larger?")
    ]
    
    # Test ResponsesAgent format preserves full context
    result_responses = get_input_messages_for_endpoint(history, "agent/v1/responses")
    
    # Should include all previous conversation context
    expected_responses = [
        {"role": "user", "content": "What's the 100th Fibonacci number?"},
        {"role": "assistant", "content": ""},
        {"role": "tool", "content": "354224848179261915075", "tool_call_id": "call-1"},
        {"role": "assistant", "content": "The 100th Fibonacci number is 354,224,848,179,261,915,075."},
        {"role": "user", "content": "What about the 50th?"},
        {"role": "assistant", "content": ""},
        {"role": "tool", "content": "12586269025", "tool_call_id": "call-2"},
        {"role": "assistant", "content": "The 50th Fibonacci number is 12,586,269,025."},
        {"role": "user", "content": "Which one is larger?"}
    ]
    
    assert result_responses == expected_responses
    
    # Test ChatCompletions format also preserves context
    result_chat = get_input_messages_for_endpoint(history, "chat/completions")
    
    # Should include all conversation turns
    expected_chat = [
        {"role": "user", "content": "What's the 100th Fibonacci number?"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "call-1", "function": {"name": "fibonacci_calc", "arguments": '{"n": 100}'}}]},
        {"role": "tool", "content": "354224848179261915075", "tool_call_id": "call-1"},
        {"role": "assistant", "content": "The 100th Fibonacci number is 354,224,848,179,261,915,075."},
        {"role": "user", "content": "What about the 50th?"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "call-2", "function": {"name": "fibonacci_calc", "arguments": '{"n": 50}'}}]},
        {"role": "tool", "content": "12586269025", "tool_call_id": "call-2"},
        {"role": "assistant", "content": "The 50th Fibonacci number is 12,586,269,025."},
        {"role": "user", "content": "Which one is larger?"}
    ]
    
    assert result_chat == expected_chat


def test_conversation_context_debugging():
    """Test to help debug conversation context issues."""
    # Simulate the exact scenario from the user's issue
    history = [
        UserMessage(content="What's the 100th fibonacci number?"),
        AssistantResponse(messages=[
            {"role": "assistant", "content": "", "tool_calls": [{"id": "call-1", "function": {"name": "system__ai__python_exec", "arguments": '{"code":"# Fibonacci calculation code"}'}}]},
            {"role": "tool", "content": "The 100th Fibonacci number is: 354224848179261915075", "tool_call_id": "call-1"},
            {"role": "assistant", "content": "The 100th Fibonacci number is 3,736,710,778,780,434,371 (or approximately 3.74 × 10^20)."}
        ], request_id="req-1"),
        UserMessage(content="What about the 50th?")
    ]
    
    # Get the input that would be sent to the ResponsesAgent endpoint
    result = get_input_messages_for_endpoint(history, "agent/v1/responses")
    
    # Verify that the agent receives full context
    assert len(result) == 5  # user + assistant + tool + assistant + user
    assert result[0]["role"] == "user"
    assert result[0]["content"] == "What's the 100th fibonacci number?"
    assert result[1]["role"] == "assistant"
    assert result[1]["content"] == ""  # Tool call message
    assert result[2]["role"] == "tool"
    assert "354224848179261915075" in result[2]["content"]
    assert result[3]["role"] == "assistant" 
    assert "100th Fibonacci number" in result[3]["content"]
    assert result[4]["role"] == "user"
    assert result[4]["content"] == "What about the 50th?"
    
    # The agent should be able to understand that "50th" refers to Fibonacci numbers
    # because it sees the full conversation history including the previous question
    # about the "100th fibonacci number" and the tool execution that calculated it
    
    print("✅ Conversation context is properly preserved!")
    print("Input messages to agent:")
    for i, msg in enumerate(result):
        print(f"  {i+1}. {msg['role']}: {msg['content'][:100]}{'...' if len(msg['content']) > 100 else ''}")
    
    # This test should pass, confirming that the conversation context is working correctly