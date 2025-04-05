import logging
import os
import streamlit as st
from model_serving_utils import query_endpoint, endpoint_supports_feedback, submit_feedback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SERVING_ENDPOINT = os.getenv('SERVING_ENDPOINT')
assert SERVING_ENDPOINT is not None, "SERVING_ENDPOINT must be set in app.yaml."

ENDPOINT_SUPPORTS_FEEDBACK = endpoint_supports_feedback(SERVING_ENDPOINT)


def get_user_info():
    headers = st.context.headers
    return dict(
        user_name=headers.get("X-Forwarded-Preferred-Username"),
        user_email=headers.get("X-Forwarded-Email"),
        user_id=headers.get("X-Forwarded-User"),
    )

user_info = get_user_info()

# --- Init state ---
if "messages" not in st.session_state:
    st.session_state.messages = []

if "visibility" not in st.session_state:
    st.session_state.visibility = "visible"
    st.session_state.disabled = False


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
for i, message in enumerate(st.session_state.messages):
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

        def save_feedback(index):
            print(f"@SID got feedback {st.session_state[f'feedback_{index}']} for message {index}")
            # st.session_state.messages[index]["feedback"] = st.session_state[f"feedback_{index}"]

        # TODO: should we drop this? or also call render_assistant_message_feedback,
        # but that results in duplicate key errors
        if message["role"] == "assistant":
            selection = st.feedback("thumbs", key=f"feedback_{i}", on_change=save_feedback, args=[i])
            if selection is not None:
                st.markdown(f"Feedback received: {'👍' if selection == 1 else '👎'}")
            print("@SID rendering feedback for existing assistant message at index ", i)
            # render_assistant_message_feedback(i)

# --- Chat input (must run BEFORE rendering messages) ---
if prompt := st.chat_input("What is up?"):
    # Add user message to chat history
    st.session_state.messages.append({"role": "user", "content": prompt})
    # Display user message in chat message container
    with st.chat_message("user"):
        st.markdown(prompt)
    # Display assistant response in chat message container
    with st.chat_message("assistant"):
        # Query the Databricks serving endpoint
        response_obj, request_id_opt = query_endpoint(
            endpoint_name=SERVING_ENDPOINT,
            messages=st.session_state.messages,
            max_tokens=400,
            return_traces=ENDPOINT_SUPPORTS_FEEDBACK
        )
        response = response_obj["content"]
        st.markdown(response)
        if request_id_opt is not None:
            render_assistant_message_feedback(len(st.session_state.messages), request_id_opt)
    st.session_state.messages.append({"role": "assistant", "content": response, "request_id": request_id_opt})
