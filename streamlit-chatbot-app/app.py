import logging
import os
import streamlit as st
from model_serving_utils import query_endpoint, endpoint_supports_feedback, submit_feedback, query_endpoint_stream

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SERVING_ENDPOINT = os.getenv('SERVING_ENDPOINT')
assert SERVING_ENDPOINT is not None, "SERVING_ENDPOINT must be set in app.yaml."

ENDPOINT_SUPPORTS_FEEDBACK = endpoint_supports_feedback(SERVING_ENDPOINT)

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

class AssistantResponse:
    def __init__(self, messages, request_id):
        self.messages = messages
        self.request_id = request_id

    def to_input_messages(self):
        return self.messages

    def render(self, idx):
        with st.chat_message("assistant"):
            for msg in self.messages:
                if msg["role"] == "assistant" and "tool_calls" in msg:
                    for call in msg["tool_calls"]:
                        fn_name = call["function"]["name"]
                        args = call["function"]["arguments"]
                        st.markdown(f"🛠️ Calling **`{fn_name}`** with:\n```json\n{args}\n```")
                elif msg["role"] == "tool":
                    st.markdown("🧰 Tool Response:")
                    st.code(msg["content"], language="json")
                elif msg["role"] == "assistant" and msg.get("content"):
                    st.markdown(msg["content"])

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
        # st.session_state.messages[index]["feedback"] = st.session_state[f"feedback_{index}"]
        submit_feedback(
            endpoint=SERVING_ENDPOINT,
            request_id=request_id,
            rating=st.session_state[f"feedback_{index}"]
        )
    selection = st.feedback("thumbs", key=f"feedback_{i}", on_change=save_feedback, args=[i])
    if selection is not None:
        st.markdown(f"Feedback received: {'👍' if selection == 1 else '👎'}")


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
    from collections import OrderedDict

    message_buffers = OrderedDict()
    tool_areas = {}

    with placeholder.container():
        with st.chat_message("assistant"):
            response_area = st.empty()
            response_area.markdown("_Thinking..._")

            input_messages = [msg for elem in st.session_state.history for msg in elem.to_input_messages()]
            request_id_opt = None

            try:
                for chunk in query_endpoint_stream(
                        endpoint_name=SERVING_ENDPOINT,
                        messages=input_messages,
                        max_tokens=400,
                        return_traces=ENDPOINT_SUPPORTS_FEEDBACK
                ):
                    delta = chunk.get("delta", {})
                    message_id = chunk.get("id")
                    role = delta.get("role")
                    content = delta.get("content", "")
                    tool_call_id = delta.get("tool_call_id")
                    request_id = chunk.get("databricks_output", {}).get("databricks_request_id")

                    if request_id:
                        request_id_opt = request_id

                    if message_id not in message_buffers:
                        message_buffers[message_id] = {
                            "role": role,
                            "content": "",
                            "tool_call_id": tool_call_id,
                            "render_area": st.empty() if role == "tool" else response_area,
                        }

                    message_buffers[message_id]["content"] += content

                    # Live update
                    render_area = message_buffers[message_id]["render_area"]
                    if role == "assistant":
                        print("rendering assistant response")
                        render_area.markdown(message_buffers[message_id]["content"] + "▌")
                    elif role == "tool":
                        print("rendering tool response")
                        render_area.markdown("🧰 Tool Response:")
                        render_area.code(message_buffers[message_id]["content"], language="json")

                # Finalize messages and append to history
                messages = []
                for msg_id, msg in message_buffers.items():
                    messages.append(msg)

                st.session_state.history.append(
                    AssistantResponse(messages=[{key: value for key, value in msg_dict.items() if key != "render_area"} for msg_dict in messages], request_id=request_id_opt)
                )
            except Exception:
                response_area.markdown("_Ran into an error. Retrying..._")  # Italic gray placeholder text
                logger.exception("Failed to query endpoint with streaming, retrying without streaming")
                response_messages, request_id_opt = query_endpoint(
                    endpoint_name=SERVING_ENDPOINT,
                    messages=input_messages,
                    max_tokens=400,
                    return_traces=ENDPOINT_SUPPORTS_FEEDBACK
                )
                # Add actual assistant response to history
                assistant_response = AssistantResponse(messages=response_messages, request_id=request_id_opt)
                st.session_state.history.append(assistant_response)
                # Update the placeholder in-place with the actual assistant response
                with placeholder.container():
                    assistant_response.render(len(st.session_state.history) - 1)

