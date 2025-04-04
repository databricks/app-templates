import logging
import os
import streamlit as st
from model_serving_utils import query_endpoint

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Ensure environment variable is set
assert os.getenv('SERVING_ENDPOINT'), "SERVING_ENDPOINT must be set in app.yaml."

# Get user headers if needed
def get_user_info():
    headers = st.context.headers
    return dict(
        user_name=headers.get("X-Forwarded-Preferred-Username"),
        user_email=headers.get("X-Forwarded-Email"),
        user_id=headers.get("X-Forwarded-User"),
    )

user_info = get_user_info()

# Initialize state
if "messages" not in st.session_state:
    st.session_state.messages = []

if "feedback" not in st.session_state:
    st.session_state.feedback = {}

st.title("🧱 Chatbot App")
st.write("A basic chatbot using your own serving endpoint.")

# Handle new prompt submission
def chat(prompt):
    st.session_state.messages.append({"role": "user", "content": prompt})
    response = query_endpoint(
        endpoint_name=os.getenv("SERVING_ENDPOINT"),
        messages=st.session_state.messages,
        max_tokens=400,
    )["content"]
    st.session_state.messages.append({"role": "assistant", "content": response})

# Prompt input
prompt = st.chat_input("What is up?")
if prompt:
    chat(prompt)  # Add new messages to session state *before* rendering anything

# Render full message history with feedback
for i, message in enumerate(st.session_state.messages):
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

        if message["role"] == "assistant":
            # Add feedback buttons with separate columns
            col1, col2 = st.columns([1, 1])
            with col1:
                if st.button("👍", key=f"thumbs_up_{i}"):
                    st.session_state.feedback[i] = "👍"
                    logger.info(f"Feedback 👍 for message {i}: {message['content']}")
            with col2:
                if st.button("👎", key=f"thumbs_down_{i}"):
                    st.session_state.feedback[i] = "👎"
                    logger.info(f"Feedback 👎 for message {i}: {message['content']}")

            # Show feedback acknowledgment
            if i in st.session_state.feedback:
                st.markdown(f"Feedback received: **{st.session_state.feedback[i]}**")
