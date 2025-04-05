import logging
import os
import streamlit as st
from model_serving_utils import query_endpoint

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

assert os.getenv('SERVING_ENDPOINT'), "SERVING_ENDPOINT must be set in app.yaml."

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

if "feedback" not in st.session_state:
    st.session_state.feedback = {}

if "visibility" not in st.session_state:
    st.session_state.visibility = "visible"
    st.session_state.disabled = False


st.title("🧱 Chatbot App")
st.write("A basic chatbot using your own serving endpoint.")

# --- Render chat history ---
for i, message in enumerate(st.session_state.messages):
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

        def save_feedback(index):
            print(f"@SID got feedback {st.session_state[f'feedback_{index}']} for message {index}")
            st.session_state.messages[index]["feedback"] = st.session_state[f"feedback_{index}"]

        if message["role"] == "assistant":
            selection = st.feedback("thumbs", key=f"feedback_{i}", on_change=save_feedback, args=[i])
            if selection is not None:
                st.markdown(f"Feedback received: {'👍' if selection == 1 else '👎'}")

# --- Chat input (must run BEFORE rendering messages) ---
if prompt := st.chat_input("What is up?"):
    st.session_state.messages.append({"role": "user", "content": prompt})
    response = query_endpoint(
        endpoint_name=os.getenv("SERVING_ENDPOINT"),
        messages=st.session_state.messages,
        max_tokens=400,
    )["content"]
    st.session_state.messages.append({"role": "assistant", "content": response})
