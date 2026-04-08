import logging
import os
import streamlit as st
from model_serving_utils import (
    query_endpoint, 
    query_endpoint_stream, 
    _get_endpoint_task_type,
    _extract_trace_id,
)
from collections import OrderedDict
from messages import UserMessage, AssistantResponse, render_message, render_assistant_message_feedback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SERVING_ENDPOINT = os.getenv('SERVING_ENDPOINT')
assert SERVING_ENDPOINT, \
    ("Unable to determine serving endpoint to use for chatbot app. If developing locally, "
     "set the SERVING_ENDPOINT environment variable to the name of your serving endpoint. If "
     "deploying to a Databricks app, include a serving endpoint resource named "
     "'serving_endpoint' with CAN_QUERY permissions, as described in "
     "https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app#deploy-the-databricks-app")


def reduce_chat_agent_chunks(chunks):
    """
    Reduce a list of ChatAgentChunk objects corresponding to a particular
    message into a single ChatAgentMessage
    """
    deltas = [chunk.delta for chunk in chunks]
    first_delta = deltas[0]
    result_msg = first_delta
    msg_contents = []
    
    # Accumulate tool calls properly
    tool_call_map = {}  # Map call_id to tool call for accumulation
    
    for delta in deltas:
        # Handle content
        if delta.content:
            msg_contents.append(delta.content)
            
        # Handle tool calls
        if hasattr(delta, 'tool_calls') and delta.tool_calls:
            for tool_call in delta.tool_calls:
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

def query_endpoint_and_render(task_type, input_messages):
    """Handle streaming response based on task type."""
    if task_type == "agent/v1/responses":
        return query_responses_endpoint_and_render(input_messages)
    elif task_type == "agent/v2/chat":
        return query_chat_agent_endpoint_and_render(input_messages)
    else:  # chat/completions
        return query_chat_completions_endpoint_and_render(input_messages)


def query_chat_completions_endpoint_and_render(input_messages):
    """Handle ChatCompletions streaming format."""
    with st.chat_message("assistant"):
        response_area = st.empty()
        response_area.markdown("_Thinking..._")
        
        accumulated_content = ""
        request_id = None
        trace_id = None
        
        try:
            for chunk in query_endpoint_stream(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=True
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
                    chunk_trace_id = _extract_trace_id(chunk)
                    if chunk_trace_id:
                        trace_id = chunk_trace_id
            
            if trace_id is not None:
                render_assistant_message_feedback(len(st.session_state.history), trace_id)

            return AssistantResponse(
                messages=[{"role": "assistant", "content": accumulated_content}],
                request_id=request_id,
                trace_id=trace_id
            )
        except Exception:
            response_area.markdown("_Ran into an error. Retrying without streaming..._")
            messages, request_id, trace_id = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=True
            )
            response_area.empty()
            with response_area.container():
                for message in messages:
                    render_message(message)
            if trace_id is not None:
                render_assistant_message_feedback(len(st.session_state.history), trace_id)
            return AssistantResponse(messages=messages, request_id=request_id, trace_id=trace_id)


def query_chat_agent_endpoint_and_render(input_messages):
    """Handle ChatAgent streaming format."""
    from mlflow.types.agent import ChatAgentChunk
    
    with st.chat_message("assistant"):
        response_area = st.empty()
        response_area.markdown("_Thinking..._")
        
        message_buffers = OrderedDict()
        request_id = None
        trace_id = None
        
        try:
            for raw_chunk in query_endpoint_stream(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=True
            ):
                # Extract trace metadata from databricks_output before parsing as ChatAgentChunk
                if "databricks_output" in raw_chunk:
                    req_id = raw_chunk["databricks_output"].get("databricks_request_id")
                    if req_id:
                        request_id = req_id
                    chunk_trace_id = _extract_trace_id(raw_chunk)
                    if chunk_trace_id:
                        trace_id = chunk_trace_id

                # Skip chunks that only carry databricks_output (no agent message data)
                if "delta" not in raw_chunk and "choices" not in raw_chunk and "type" not in raw_chunk:
                    continue

                response_area.empty()
                chunk = ChatAgentChunk.model_validate(raw_chunk)
                delta = chunk.delta
                message_id = delta.id

                if message_id not in message_buffers:
                    message_buffers[message_id] = {
                        "chunks": [],
                        "render_area": st.empty(),
                    }
                message_buffers[message_id]["chunks"].append(chunk)
                
                partial_message = reduce_chat_agent_chunks(message_buffers[message_id]["chunks"])
                render_area = message_buffers[message_id]["render_area"]
                message_content = partial_message.model_dump_compat(exclude_none=True)
                with render_area.container():
                    render_message(message_content)
            
            messages = []
            for msg_id, msg_info in message_buffers.items():
                messages.append(reduce_chat_agent_chunks(msg_info["chunks"]))
            
            if trace_id is not None:
                render_assistant_message_feedback(len(st.session_state.history), trace_id)

            return AssistantResponse(
                messages=[message.model_dump_compat(exclude_none=True) for message in messages],
                request_id=request_id,
                trace_id=trace_id
            )
        except Exception:
            response_area.markdown("_Ran into an error. Retrying without streaming..._")
            messages, request_id, trace_id = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=True
            )
            response_area.empty()
            with response_area.container():
                for message in messages:
                    render_message(message)
            if trace_id is not None:
                render_assistant_message_feedback(len(st.session_state.history), trace_id)
            return AssistantResponse(messages=messages, request_id=request_id, trace_id=trace_id)


def query_responses_endpoint_and_render(input_messages):
    """Handle ResponsesAgent streaming format using MLflow types."""
    from mlflow.types.responses import ResponsesAgentStreamEvent
    
    with st.chat_message("assistant"):
        response_area = st.empty()
        response_area.markdown("_Thinking..._")
        
        all_messages = []
        request_id = None
        trace_id = None

        try:
            for raw_event in query_endpoint_stream(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=True
            ):
                if "databricks_output" in raw_event:
                    req_id = raw_event["databricks_output"].get("databricks_request_id")
                    if req_id:
                        request_id = req_id
                    event_trace_id = _extract_trace_id(raw_event)
                    if event_trace_id:
                        trace_id = event_trace_id
                
                if "type" in raw_event:
                    event = ResponsesAgentStreamEvent.model_validate(raw_event)
                    
                    if hasattr(event, 'item') and event.item:
                        item = event.item
                        
                        if item.get("type") == "message":
                            content_parts = item.get("content", [])
                            for content_part in content_parts:
                                if content_part.get("type") == "output_text":
                                    text = content_part.get("text", "")
                                    if text:
                                        all_messages.append({
                                            "role": "assistant",
                                            "content": text
                                        })
                            
                        elif item.get("type") == "function_call":
                            call_id = item.get("call_id")
                            function_name = item.get("name")
                            arguments = item.get("arguments", "")
                            
                            all_messages.append({
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [{
                                    "id": call_id,
                                    "type": "function",
                                    "function": {
                                        "name": function_name,
                                        "arguments": arguments
                                    }
                                }]
                            })
                            
                        elif item.get("type") == "function_call_output":
                            call_id = item.get("call_id")
                            output = item.get("output", "")
                            
                            all_messages.append({
                                "role": "tool",
                                "content": output,
                                "tool_call_id": call_id
                            })
                
                if all_messages:
                    with response_area.container():
                        for msg in all_messages:
                            render_message(msg)

            if trace_id is not None:
                render_assistant_message_feedback(len(st.session_state.history), trace_id)

            return AssistantResponse(messages=all_messages, request_id=request_id, trace_id=trace_id)
        except Exception:
            response_area.markdown("_Ran into an error. Retrying without streaming..._")
            messages, request_id, trace_id = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=True
            )
            response_area.empty()
            with response_area.container():
                for message in messages:
                    render_message(message)
            if trace_id is not None:
                render_assistant_message_feedback(len(st.session_state.history), trace_id)
            return AssistantResponse(messages=messages, request_id=request_id, trace_id=trace_id)




# --- Chat input (must run BEFORE rendering messages) ---
prompt = st.chat_input("Ask a question")
if prompt:
    # Get the task type for this endpoint
    task_type = _get_endpoint_task_type(SERVING_ENDPOINT)
    
    # Add user message to chat history
    user_msg = UserMessage(content=prompt)
    st.session_state.history.append(user_msg)
    user_msg.render(len(st.session_state.history) - 1)

    # Convert history to standard chat message format for the query methods
    input_messages = [msg for elem in st.session_state.history for msg in elem.to_input_messages()]
    
    # Handle the response using the appropriate handler
    assistant_response = query_endpoint_and_render(task_type, input_messages)
    
    # Add assistant response to history
    st.session_state.history.append(assistant_response)
