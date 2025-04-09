import logging
import os
import streamlit as st
from model_serving_utils import query_endpoint, endpoint_supports_feedback, submit_feedback, query_endpoint_stream
from collections import OrderedDict
from chunks import TEST_DICTS
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
    for delta in deltas[1:]:
        if delta.tool_calls:
            result_msg = result_msg.copy(tool_calls=delta.tool_calls)
        if delta.tool_call_id:
            result_msg = result_msg.copy(tool_call_id=delta.tool_call_id)
    return result_msg


class UserMessage:
    def __init__(self, content):
        self.content = content

    def to_input_messages(self):
        return [{
            "role": "user",
            "content": self.content
        }]

    def render(self, idx):
        with st.chat_message("user"):
            st.markdown(self.content)

def render_message(msg):
    if msg["role"] == "assistant" and "tool_calls" in msg:
        for call in msg["tool_calls"]:
            fn_name = call["function"]["name"]
            args = call["function"]["arguments"]
            st.markdown(msg["content"])
            st.markdown(f"🛠️ Calling **`{fn_name}`** with:\n```json\n{args}\n```")
    elif msg["role"] == "tool":
        st.markdown("🧰 Tool Response:")
        st.code(msg["content"], language="json")
    elif msg["role"] == "assistant" and msg.get("content"):
        st.markdown(msg["content"])

class AssistantResponse:
    def __init__(self, messages, request_id):
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



def get_user_info():
    headers = st.context.headers
    return dict(
        user_name=headers.get("X-Forwarded-Preferred-Username"),
        user_email=headers.get("X-Forwarded-Email"),
        user_id=headers.get("X-Forwarded-User"),
    )

user_info = get_user_info()

# --- Init state ---
if "history" not in st.session_state:
    st.session_state.history = []

st.title("🧱 Chatbot App")
st.write("A basic chatbot using your own serving endpoint.")

def render_assistant_message_feedback(i, request_id):
    def save_feedback(index):
        submit_feedback(
            endpoint=SERVING_ENDPOINT,
            request_id=request_id,
            rating=st.session_state[f"feedback_{index}"]
        )
    selection = st.feedback("thumbs", key=f"feedback_{i}", on_change=save_feedback, args=[i])


# --- Render chat history ---
for i, element in enumerate(st.session_state.history):
    element.render(i)

# --- Chat input (must run BEFORE rendering messages) ---
if prompt := st.chat_input("Ask a question"):
    # Add user message to chat history
    user_msg = UserMessage(content=prompt)
    st.session_state.history.append(user_msg)
    user_msg.render(len(st.session_state.history) - 1)

    # Placeholder for assistant response
    placeholder = st.empty()

    message_buffers = OrderedDict()
    tool_areas = {}

    # Track the render area of the previous assistant message to clear the cursor
    previous_msg_id = None

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
                    role = delta.role
                    content = delta.content
                    tool_call_id = delta.tool_call_id
                    request_id = raw_chunk.get("databricks_output", {}).get("databricks_request_id")

                    if request_id:
                        request_id_opt = request_id

                    if message_id not in message_buffers:
                        message_buffers[message_id] = {
                            "chunks": [],
                            "render_area": st.empty(),
                        }
                        if previous_msg_id is not None:
                            # re-render the previous message, removing any trailing cursor characters
                            prev_msg_info = message_buffers[previous_msg_id]
                            prev_msg_chunks = prev_msg_info["chunks"]
                            prev_msg_render_area = prev_msg_info["render_area"]
                            with prev_msg_render_area.container():
                                render_message(reduce_chunks(prev_msg_chunks).model_dump_compat(exclude_none=True))
                        previous_msg_id = message_id
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
                response_area.markdown("_Ran into an error. Retrying..._")  # Italic gray placeholder text
                logger.exception("Failed to query endpoint with streaming, retrying without streaming")
                response_messages, request_id_opt = query_endpoint(
                    endpoint_name=SERVING_ENDPOINT,
                    messages=input_messages,
                    max_tokens=400,
                    return_traces=ENDPOINT_SUPPORTS_FEEDBACK
                )
                assistant_response = AssistantResponse(messages=response_messages, request_id=request_id_opt)
            # Add actual assistant response to history
            st.session_state.history.append(assistant_response)
            # Update the placeholder in-place with the actual assistant response
            with placeholder.container():
                assistant_response.render(len(st.session_state.history) - 1)
