import streamlit as st
import os
# If using OpenAI API
from openai import OpenAI 
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

# Initialize the Databricks Workspace Client
w = WorkspaceClient()

def get_user_info():
    headers = st.context.headers
    return dict(
        user_name=headers.get("X-Forwarded-Preferred-Username"),
        user_email=headers.get("X-Forwarded-Email"),
        user_id=headers.get("X-Forwarded-User"),
        access_token=headers.get("X-Forwarded-Access-Token")
    )

user_info = get_user_info()

model_mapping = {
    "DBRX Instruct": "databricks-dbrx-instruct",
    "Meta Llama 3.1 70B Instruct": "databricks-meta-llama-3-1-70b-instruct",
    "Mixtral-8x7B Instruct": "databricks-mixtral-8x7b-instruct",
    "Your Own Model": os.getenv("SERVING_ENDPOINT")
}

# Streamlit app
if "visibility" not in st.session_state:
    st.session_state.visibility = "visible"
    st.session_state.disabled = False

with st.sidebar:
    model_option = st.selectbox(
        "Choose a LLM (optional)",
        ("DBRX Instruct", "Meta Llama 3.1 70B Instruct", "Mixtral-8x7B Instruct", "Your Own Model"),
        label_visibility=st.session_state.visibility,
        disabled=st.session_state.disabled,
        placeholder="DBRX Instruct",
    )
    temperature = st.slider(
        "Temperature",
        value=0.0,
        min_value=0.0,
        max_value=1.0,
    )
    max_tokens = st.select_slider(
        "Max tokens",
        options=[256, 512, 1024],
        value=256
    )

# Set Dabricks API key (if using OpenAI API)
client = OpenAI(
    api_key=user_info.get("access_token"),
    base_url=f"https://{os.getenv('DATABRICKS_HOST')}/serving-endpoints"
)

st.title("🧱 Chatbot App")
st.write(f"A basic chatbot using the `{model_option}` Foundation Model API.")
         
# Initialize chat history
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display chat messages from history on app rerun
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# Accept user input
if prompt := st.chat_input("What is up?"):
    # Add user message to chat history
    st.session_state.messages.append({"role": "user", "content": prompt})
    # Display user message in chat message container
    with st.chat_message("user"):
        st.markdown(prompt)

    messages = [ChatMessage(role=ChatMessageRole.SYSTEM, content="You are a helpful assistant."),
                ChatMessage(role=ChatMessageRole.USER, content=prompt)]

    # Display assistant response in chat message container
    with st.chat_message("assistant"):
        # If using OpenAI API
        stream = client.chat.completions.create(
            messages=[
                {"role": m["role"], "content": m["content"]}
                for m in st.session_state.messages
            ],
            model=model_mapping[model_option],
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
        )
        response = st.write_stream(stream)
        
    # Add assistant response to chat history
    st.session_state.messages.append({"role": "assistant", "content": response})