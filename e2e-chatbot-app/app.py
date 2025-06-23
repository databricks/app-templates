import logging
import os
import streamlit as st
from model_serving_utils import (
    endpoint_supports_feedback, 
    query_endpoint, 
    query_endpoint_stream, 
    _get_endpoint_task_type,
    submit_feedback
)
from collections import OrderedDict
from messages import Message, UserMessage, AssistantResponse, render_message

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SERVING_ENDPOINT = os.getenv('SERVING_ENDPOINT')
assert SERVING_ENDPOINT is not None, "SERVING_ENDPOINT must be set in app.yaml."

ENDPOINT_SUPPORTS_FEEDBACK = endpoint_supports_feedback(SERVING_ENDPOINT)

def reduce_chunks(chunks):
    """
    Reduce a list of ChatAgentChunk objects corresponding to a particular
    message into a single ChatAgentMessage
    """
    deltas = [chunk.delta for chunk in chunks]
    first_delta = deltas[0]
    result_msg = first_delta
    msg_contents = []
    
    # Accumulate tool calls properly
    accumulated_tool_calls = []
    tool_call_map = {}  # Map call_id to tool call for accumulation
    
    for delta in deltas:
        # Handle content
        if delta.content:
            msg_contents.append(delta.content)
            
        # Handle tool calls
        if hasattr(delta, 'tool_calls') and delta.tool_calls:
            for tool_call in delta.tool_calls:
                # Handle both dict and object formats
                if hasattr(tool_call, 'get'):
                    # Dictionary format
                    call_id = tool_call.get("id")
                    tool_type = tool_call.get("type", "function")
                    function_info = tool_call.get("function", {})
                    func_name = function_info.get("name", "")
                    func_args = function_info.get("arguments", "")
                else:
                    # Object format (Pydantic model)
                    call_id = getattr(tool_call, 'id', None)
                    tool_type = getattr(tool_call, 'type', "function")
                    function_info = getattr(tool_call, 'function', None)
                    if function_info:
                        func_name = getattr(function_info, 'name', "")
                        func_args = getattr(function_info, 'arguments', "")
                    else:
                        func_name = ""
                        func_args = ""
                
                if call_id:
                    if call_id not in tool_call_map:
                        # New tool call
                        tool_call_map[call_id] = {
                            "id": call_id,
                            "type": tool_type,
                            "function": {
                                "name": func_name,
                                "arguments": func_args
                            }
                        }
                    else:
                        # Accumulate arguments for existing tool call
                        existing_args = tool_call_map[call_id]["function"]["arguments"]
                        tool_call_map[call_id]["function"]["arguments"] = existing_args + func_args
                        
                        # Update function name if provided
                        if func_name:
                            tool_call_map[call_id]["function"]["name"] = func_name
        
        # Handle tool call IDs (for tool response messages)
        if hasattr(delta, 'tool_call_id') and delta.tool_call_id:
            result_msg = result_msg.model_copy(update={"tool_call_id": delta.tool_call_id})
    
    # Convert tool call map back to list
    if tool_call_map:
        accumulated_tool_calls = list(tool_call_map.values())
        result_msg = result_msg.model_copy(update={"tool_calls": accumulated_tool_calls})
    
    result_msg = result_msg.model_copy(update={"content": "".join(msg_contents)})
    return result_msg



# --- Init state ---
if "history" not in st.session_state:
    st.session_state.history = []

st.title("🧱 Chatbot App")
st.write(f"A basic chatbot using your own serving endpoint.")
st.write(f"Endpoint name: `{SERVING_ENDPOINT}`")



# --- Render chat history ---
for i, element in enumerate(st.session_state.history):
    element.render(i)

def get_input_messages_for_endpoint(history, task_type):
    """Convert message history to the format expected by the endpoint based on task type."""
    if task_type == "agent/v1/responses":
        # ResponsesAgent format
        messages = []
        for message in history:
            if isinstance(message, UserMessage):
                messages.append({"role": "user", "content": message.content})
            elif isinstance(message, AssistantResponse):
                for msg in message.messages:
                    if msg["role"] == "assistant":
                        if msg.get("tool_calls"):
                            messages.append({"role": "assistant", "content": msg.get("content", "")})
                        else:
                            messages.append({"role": "assistant", "content": msg["content"]})
                    elif msg["role"] == "tool":
                        messages.append({
                            "role": "tool", 
                            "content": msg["content"],
                            "tool_call_id": msg.get("tool_call_id")
                        })
            else:
                raise ValueError(f"Unsupported message type: {type(message)}")
        return messages
    else:
        # ChatCompletions and ChatAgent format (same input format)
        messages = []
        for elem in history:
            messages.extend(elem.to_input_messages())
        return messages


def handle_streaming_response(task_type, input_messages, max_tokens):
    """Handle streaming response based on task type."""
    if task_type == "agent/v1/responses":
        return handle_responses_streaming(input_messages, max_tokens)
    elif task_type == "agents/v2/chat":
        return handle_chat_agent_streaming(input_messages, max_tokens)
    else:  # chat/completions
        return handle_chat_completions_streaming(input_messages, max_tokens)


def handle_chat_completions_streaming(input_messages, max_tokens):
    """Handle ChatCompletions streaming format."""
    with st.chat_message("assistant"):
        response_area = st.empty()
        response_area.markdown("_Thinking..._")
        
        accumulated_content = ""
        request_id = None
        
        try:
            for chunk in query_endpoint_stream(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                max_tokens=max_tokens,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            ):
                if "choices" in chunk and chunk["choices"]:
                    delta = chunk["choices"][0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        accumulated_content += content
                        response_area.markdown(accumulated_content)
                
                if "databricks_output" in chunk:
                    req_id = chunk["databricks_output"].get("databricks_request_id")
                    if req_id:
                        request_id = req_id
            
            return AssistantResponse(
                messages=[{"role": "assistant", "content": accumulated_content}],
                request_id=request_id
            )
        
        except Exception:
            response_area.markdown("_Ran into an error. Retrying without streaming..._")
            messages, request_id = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                max_tokens=max_tokens,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            )
            return AssistantResponse(messages=messages, request_id=request_id)


def handle_chat_agent_streaming(input_messages, max_tokens):
    """Handle ChatAgent streaming format."""
    from mlflow.types.agent import ChatAgentChunk
    
    with st.chat_message("assistant"):
        response_area = st.empty()
        response_area.markdown("_Thinking..._")
        
        message_buffers = OrderedDict()
        request_id = None
        
        try:
            for raw_chunk in query_endpoint_stream(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                max_tokens=max_tokens,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            ):
                response_area.empty()
                chunk = ChatAgentChunk.model_validate(raw_chunk)
                delta = chunk.delta
                message_id = delta.id
                
                req_id = raw_chunk.get("databricks_output", {}).get("databricks_request_id")
                if req_id:
                    request_id = req_id
                
                if message_id not in message_buffers:
                    message_buffers[message_id] = {
                        "chunks": [],
                        "render_area": st.empty(),
                    }
                message_buffers[message_id]["chunks"].append(chunk)
                
                partial_message = reduce_chunks(message_buffers[message_id]["chunks"])
                render_area = message_buffers[message_id]["render_area"]
                with render_area.container():
                    render_message(partial_message.model_dump_compat(exclude_none=True))
            
            messages = []
            for msg_id, msg_info in message_buffers.items():
                messages.append(reduce_chunks(msg_info["chunks"]))
            
            return AssistantResponse(
                messages=[message.model_dump_compat(exclude_none=True) for message in messages],
                request_id=request_id
            )
        
        except Exception:
            response_area.markdown("_Ran into an error. Retrying without streaming..._")
            messages, request_id = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                max_tokens=max_tokens,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            )
            return AssistantResponse(messages=messages, request_id=request_id)


def handle_responses_streaming(input_messages, max_tokens):
    """Handle ResponsesAgent streaming format."""
    with st.chat_message("assistant"):
        response_area = st.empty()
        response_area.markdown("_Thinking..._")
        
        # Track all the components that need to be rendered in order
        rendered_components = []
        all_messages = []
        request_id = None
        
        try:
            for event in query_endpoint_stream(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                max_tokens=max_tokens,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            ):
                if "databricks_output" in event:
                    req_id = event["databricks_output"].get("databricks_request_id")
                    if req_id:
                        request_id = req_id
                
                if "delta" in event:
                    delta = event["delta"]
                    role = delta.get("role")
                    
                    if role == "assistant":
                        content = delta.get("content", "")
                        tool_calls = delta.get("tool_calls", [])
                        
                        # Handle tool calls first
                        if tool_calls:
                            for tool_call in tool_calls:
                                fn_name = tool_call["function"]["name"]
                                args = tool_call["function"]["arguments"]
                                tool_call_text = f"🛠️ Calling **`{fn_name}`** with:\n```json\n{args}\n```"
                                rendered_components.append({"type": "tool_call", "content": tool_call_text})
                                
                                # Add to messages for history
                                all_messages.append({
                                    "role": "assistant",
                                    "content": "",
                                    "tool_calls": [tool_call]
                                })
                        
                        # Handle assistant content (this comes after tool execution)
                        if content:
                            # Look for existing assistant content component to update
                            found_content = False
                            for component in rendered_components:
                                if component["type"] == "assistant_content":
                                    component["content"] += content
                                    found_content = True
                                    break
                            
                            if not found_content:
                                rendered_components.append({"type": "assistant_content", "content": content})
                    
                    elif role == "tool":
                        tool_content = delta.get("content", "")
                        tool_call_id = delta.get("tool_call_id")
                        
                        if tool_content and tool_call_id:
                            tool_response_text = f"🧰 Tool Response:\n```json\n{tool_content}\n```"
                            rendered_components.append({"type": "tool_response", "content": tool_response_text})
                            
                            # Add to messages for history
                            all_messages.append({
                                "role": "tool",
                                "content": tool_content,
                                "tool_call_id": tool_call_id
                            })
                
                # Update the display with all components in order
                display_content = []
                for component in rendered_components:
                    display_content.append(component["content"])
                
                if display_content:
                    response_area.markdown("\n\n".join(display_content))
            
            # Add final assistant content to messages if any
            final_assistant_content = ""
            for component in rendered_components:
                if component["type"] == "assistant_content":
                    final_assistant_content += component["content"]
            
            if final_assistant_content:
                all_messages.append({
                    "role": "assistant", 
                    "content": final_assistant_content
                })
            
            return AssistantResponse(messages=all_messages, request_id=request_id)
        
        except Exception:
            response_area.markdown("_Ran into an error. Retrying without streaming..._")
            messages, request_id = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                max_tokens=max_tokens,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            )
            return AssistantResponse(messages=messages, request_id=request_id)




# --- Chat input (must run BEFORE rendering messages) ---
prompt = st.chat_input("Ask a question")
if prompt:
    # Get the task type for this endpoint
    task_type = _get_endpoint_task_type(SERVING_ENDPOINT)
    
    # Add user message to chat history
    user_msg = UserMessage(content=prompt)
    st.session_state.history.append(user_msg)
    user_msg.render(len(st.session_state.history) - 1)

    # Convert history to the format expected by this endpoint type
    input_messages = get_input_messages_for_endpoint(st.session_state.history, task_type)
    
    # Handle the response using the appropriate handler
    try:
        assistant_response = handle_streaming_response(task_type, input_messages, max_tokens=400)
    except Exception as e:
        logger.exception("Failed to handle response")
        # Create a basic error response
        assistant_response = AssistantResponse(
            messages=[{"role": "assistant", "content": "Sorry, I encountered an error processing your request."}],
            request_id=None
        )
    
    # Add assistant response to history
    st.session_state.history.append(assistant_response)
