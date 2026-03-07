import logging
import os
import streamlit as st
from model_serving_utils import (
    endpoint_supports_feedback, 
    query_endpoint, 
    query_endpoint_stream, 
    _get_endpoint_task_type,
)
from collections import OrderedDict
from messages import UserMessage, AssistantResponse, render_message

# Configure Streamlit page for Gainwell branding
st.set_page_config(
    page_title="Gainwell AI Assistant",
    page_icon="./gainwell_logo.svg",
    layout="wide",
    initial_sidebar_state="collapsed"
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SERVING_ENDPOINT = os.getenv('SERVING_ENDPOINT')
assert SERVING_ENDPOINT, \
    ("Unable to determine serving endpoint to use for chatbot app. If developing locally, "
     "set the SERVING_ENDPOINT environment variable to the name of your serving endpoint. If "
     "deploying to a Databricks app, include a serving endpoint resource named "
     "'serving_endpoint' with CAN_QUERY permissions, as described in "
     "https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app#deploy-the-databricks-app")

ENDPOINT_SUPPORTS_FEEDBACK = endpoint_supports_feedback(SERVING_ENDPOINT)

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

# Custom CSS for Gainwell branding
st.markdown("""
<style>
    /* Main container styling */
    .main > div {
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        padding: 2rem;
        border-radius: 10px;
        margin-bottom: 1rem;
    }
    
    /* Header styling */
    .gainwell-header {
        background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
        color: white;
        padding: 2rem;
        border-radius: 15px;
        margin-bottom: 2rem;
        box-shadow: 0 10px 25px rgba(30, 64, 175, 0.2);
    }
    
    .gainwell-title {
        font-size: 2.5rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        text-align: center;
    }
    
    .gainwell-tagline {
        font-size: 1.2rem;
        text-align: center;
        opacity: 0.9;
        margin-bottom: 1rem;
    }
    
    .gainwell-description {
        font-size: 1rem;
        text-align: center;
        opacity: 0.8;
        max-width: 600px;
        margin: 0 auto;
    }
    
    /* Chat message styling */
    .stChatMessage {
        background: white;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        margin-bottom: 1rem;
    }
    
    /* Input styling */
    .stChatInputContainer {
        background: white;
        border-radius: 15px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    /* Status indicator */
    .status-indicator {
        background: #f0f9ff;
        border: 1px solid #0ea5e9;
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 1.5rem;
        color: #0c4a6e;
    }
    
    .status-label {
        font-weight: 600;
        margin-bottom: 0.5rem;
    }
    
    .status-value {
        font-family: 'Courier New', monospace;
        background: #e0f2fe;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.9rem;
    }
</style>
""", unsafe_allow_html=True)

# Gainwell-branded header
with open('/Users/sam.sisto/app-templates/e2e-chatbot-app/gainwell_logo.svg', 'r') as f:
    logo_svg = f.read()

st.markdown(f"""
<div class="gainwell-header">
    <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
        <div style="width: 60px; height: 60px; margin-right: 1rem;">
            {logo_svg}
        </div>
        <div class="gainwell-title" style="margin-bottom: 0;">Gainwell AI Assistant</div>
    </div>
    <div class="gainwell-tagline">Reliability. Innovation. Delivered.</div>
    <div class="gainwell-description">
        Your intelligent healthcare companion powered by advanced AI technology. 
        Supporting Medicaid modernization and public health initiatives with data-driven insights.
    </div>
</div>
""", unsafe_allow_html=True)

# Status indicator
st.markdown(f"""
<div class="status-indicator">
    <div class="status-label">🔗 Connected AI Endpoint:</div>
    <div class="status-value">{SERVING_ENDPOINT}</div>
</div>
""", unsafe_allow_html=True)



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
        
        try:
            for chunk in query_endpoint_stream(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
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
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            )
            response_area.empty()
            with response_area.container():
                for message in messages:
                    render_message(message)
            return AssistantResponse(messages=messages, request_id=request_id)


def query_chat_agent_endpoint_and_render(input_messages):
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
                
                partial_message = reduce_chat_agent_chunks(message_buffers[message_id]["chunks"])
                render_area = message_buffers[message_id]["render_area"]
                message_content = partial_message.model_dump_compat(exclude_none=True)
                with render_area.container():
                    render_message(message_content)
            
            messages = []
            for msg_id, msg_info in message_buffers.items():
                messages.append(reduce_chat_agent_chunks(msg_info["chunks"]))
            
            return AssistantResponse(
                messages=[message.model_dump_compat(exclude_none=True) for message in messages],
                request_id=request_id
            )
        except Exception:
            response_area.markdown("_Ran into an error. Retrying without streaming..._")
            messages, request_id = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            )
            response_area.empty()
            with response_area.container():
                for message in messages:
                    render_message(message)
            return AssistantResponse(messages=messages, request_id=request_id)


def query_responses_endpoint_and_render(input_messages):
    """Handle ResponsesAgent streaming format using MLflow types."""
    from mlflow.types.responses import ResponsesAgentStreamEvent
    
    with st.chat_message("assistant"):
        response_area = st.empty()
        response_area.markdown("_Thinking..._")
        
        # Track all the messages that need to be rendered in order
        all_messages = []
        request_id = None

        try:
            for raw_event in query_endpoint_stream(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            ):
                # Extract databricks_output for request_id
                if "databricks_output" in raw_event:
                    req_id = raw_event["databricks_output"].get("databricks_request_id")
                    if req_id:
                        request_id = req_id
                
                # Parse using MLflow streaming event types, similar to ChatAgentChunk
                if "type" in raw_event:
                    event = ResponsesAgentStreamEvent.model_validate(raw_event)
                    
                    if hasattr(event, 'item') and event.item:
                        item = event.item  # This is a dict, not a parsed object
                        
                        if item.get("type") == "message":
                            # Extract text content from message if present
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
                            # Tool call
                            call_id = item.get("call_id")
                            function_name = item.get("name")
                            arguments = item.get("arguments", "")
                            
                            # Add to messages for history
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
                            # Tool call output/result
                            call_id = item.get("call_id")
                            output = item.get("output", "")
                            
                            # Add to messages for history
                            all_messages.append({
                                "role": "tool",
                                "content": output,
                                "tool_call_id": call_id
                            })
                
                # Update the display by rendering all accumulated messages
                if all_messages:
                    with response_area.container():
                        for msg in all_messages:
                            render_message(msg)

            return AssistantResponse(messages=all_messages, request_id=request_id)
        except Exception:
            response_area.markdown("_Ran into an error. Retrying without streaming..._")
            messages, request_id = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=input_messages,
                return_traces=ENDPOINT_SUPPORTS_FEEDBACK
            )
            response_area.empty()
            with response_area.container():
                for message in messages:
                    render_message(message)
            return AssistantResponse(messages=messages, request_id=request_id)




# --- Healthcare-focused suggestions ---
if not st.session_state.history:
    st.markdown(f"""
    <div style="background: #fefce8; border: 1px solid #eab308; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem;">
        <div style="display: flex; align-items: center; margin-bottom: 1rem;">
            <div style="width: 30px; height: 30px; margin-right: 0.5rem;">
                {logo_svg}
            </div>
            <h4 style="color: #a16207; margin: 0;">Healthcare Use Cases</h4>
        </div>
        <p style="color: #a16207; margin-bottom: 1rem;">Ask me about healthcare topics such as:</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
            <div style="background: white; padding: 1rem; border-radius: 8px;">
                <strong>Medicaid & Public Health</strong><br>
                <small>Program management, enrollment, compliance</small>
            </div>
            <div style="background: white; padding: 1rem; border-radius: 8px;">
                <strong>Data Analytics</strong><br>
                <small>Population health insights, cost analysis</small>
            </div>
            <div style="background: white; padding: 1rem; border-radius: 8px;">
                <strong>System Integration</strong><br>
                <small>Interoperability, workflow optimization</small>
            </div>
            <div style="background: white; padding: 1rem; border-radius: 8px;">
                <strong>Care Management</strong><br>
                <small>Quality metrics, patient outcomes</small>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

# --- Chat input with healthcare-focused placeholder ---
prompt = st.chat_input("Ask about healthcare data, Medicaid programs, or population health insights...")
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

# --- Footer ---
st.markdown(f"""
---
<div style="text-align: center; padding: 2rem 0; color: #64748b;">
    <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
        <div style="width: 30px; height: 30px; margin-right: 0.5rem;">
            {logo_svg}
        </div>
        <strong>Gainwell Technologies</strong>
    </div>
    <div style="font-size: 0.9rem;">
        Healthcare Innovation & Modernization<br>
        Supporting Medicaid agencies, providers, and public health initiatives nationwide<br>
        <a href="https://www.gainwelltechnologies.com/" target="_blank" style="color: #3b82f6; text-decoration: none;">Learn more about Gainwell Technologies</a>
    </div>
</div>
""", unsafe_allow_html=True)
