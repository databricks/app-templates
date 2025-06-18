import logging
import os
import streamlit as st
from abc import ABC, abstractmethod
from model_serving_utils import query_endpoint, endpoint_supports_feedback, submit_feedback, query_endpoint_stream
from collections import OrderedDict
from mlflow.types.agent import ChatAgentChunk, ChatAgentMessage

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


class Message(ABC):
    def __init__(self):
        pass

    @abstractmethod
    def to_input_messages(self):
        """Convert this message into a list of dicts suitable for the model API."""
        pass

    @abstractmethod
    def render(self, idx):
        """Render the message in the Streamlit app."""
        pass


class UserMessage(Message):
    def __init__(self, content):
        super().__init__()
        self.content = content

    def to_input_messages(self):
        return [{
            "role": "user",
            "content": self.content
        }]

    def render(self, idx):
        with st.chat_message("user"):
            st.markdown(self.content)


class AssistantResponse(Message):
    def __init__(self, messages, request_id):
        super().__init__()
        self.messages = messages
        self.request_id = request_id

    def to_input_messages(self):
        return self.messages

    def render(self, idx):
        with st.chat_message("assistant"):
            for msg in self.messages:
                render_message(msg)

            if self.request_id is not None:
                render_assistant_message_feedback(idx, self.request_id)


def render_message(msg):
    if msg["role"] == "assistant":
        # Render content first if it exists
        if msg.get("content"):
            st.markdown(msg["content"])
        
        # Then render tool calls if they exist
        if "tool_calls" in msg and msg["tool_calls"]:
            for call in msg["tool_calls"]:
                fn_name = call["function"]["name"]
                args = call["function"]["arguments"]
                st.markdown(f"🛠️ Calling **`{fn_name}`** with:\n```json\n{args}\n```")
    elif msg["role"] == "tool":
        st.markdown("🧰 Tool Response:")
        st.code(msg["content"], language="json")

# --- Init state ---
if "history" not in st.session_state:
    st.session_state.history = []

st.title("🧱 Chatbot App")
st.write(f"A basic chatbot using your own serving endpoint.")
st.write(f"Endpoint name: `{SERVING_ENDPOINT}`")

@st.fragment
def render_assistant_message_feedback(i, request_id):
    def save_feedback(index):
        submit_feedback(
            endpoint=SERVING_ENDPOINT,
            request_id=request_id,
            rating=st.session_state[f"feedback_{index}"]
        )
    st.feedback("thumbs", key=f"feedback_{i}", on_change=save_feedback, args=[i])


# --- Render chat history ---
for i, element in enumerate(st.session_state.history):
    element.render(i)

# --- Chat input (must run BEFORE rendering messages) ---
prompt = st.chat_input("Ask a question")
if prompt:
    # Add user message to chat history
    user_msg = UserMessage(content=prompt)
    st.session_state.history.append(user_msg)
    user_msg.render(len(st.session_state.history) - 1)

    # Placeholder for assistant response
    placeholder = st.empty()
    message_buffers = OrderedDict()
    with placeholder.container():
        with st.chat_message("assistant"):
            response_area = st.empty()
            response_area.markdown("_Thinking..._")

            input_messages = [msg for elem in st.session_state.history for msg in elem.to_input_messages()]
            request_id_opt = None

            try:
                for raw_chunk in query_endpoint_stream(
                        endpoint_name=SERVING_ENDPOINT,
                        messages=input_messages,
                        max_tokens=400,
                        return_traces=ENDPOINT_SUPPORTS_FEEDBACK
                ):
                    response_area.empty()  # Clear previous response
                    chunk = ChatAgentChunk.model_validate(raw_chunk)
                    delta = chunk.delta
                    message_id = delta.id
                    request_id = raw_chunk.get("databricks_output", {}).get("databricks_request_id")

                    if request_id:
                        request_id_opt = request_id

                    if message_id not in message_buffers:
                        message_buffers[message_id] = {
                            "chunks": [],
                            "render_area": st.empty(),
                        }
                    message_buffers[message_id]["chunks"].append(chunk)

                    # Live update - render the current partial message's content
                    partial_message = reduce_chunks(message_buffers[message_id]["chunks"])
                    render_area = message_buffers[message_id]["render_area"]
                    with render_area.container():
                        render_message(partial_message.model_dump_compat(exclude_none=True))

                # Finalize messages and append to history
                messages = []
                for msg_id, msg_info in message_buffers.items():
                    messages.append(reduce_chunks(msg_info["chunks"]))

                assistant_response = AssistantResponse(messages=[message.model_dump_compat(exclude_none=True) for message in messages], request_id=request_id_opt)
            except Exception:
                raise
                response_area.markdown("_Ran into an error. Retrying..._")  # Italic gray placeholder text
                logger.exception("Failed to query endpoint with streaming, retrying without streaming")
                response_messages, request_id_opt = query_endpoint(
                    endpoint_name=SERVING_ENDPOINT,
                    messages=input_messages,
                    max_tokens=400,
                    return_traces=ENDPOINT_SUPPORTS_FEEDBACK
                )
                assistant_response = AssistantResponse(messages=response_messages, request_id=request_id_opt)
            # Update the placeholder with final assistant response
            with placeholder.container():
                assistant_response.render(len(st.session_state.history) - 1)
            # Add actual assistant response to history
            st.session_state.history.append(assistant_response)
