import logging
import os
import streamlit as st
from model_serving_utils import query_endpoint, endpoint_supports_feedback, submit_feedback

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
    with placeholder.container():
        with st.chat_message("assistant"):
            st.markdown("_Thinking..._")  # Italic gray placeholder text

    # Generate full message
    input_messages = [msg for elem in st.session_state.history for msg in elem.to_input_messages()]
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

