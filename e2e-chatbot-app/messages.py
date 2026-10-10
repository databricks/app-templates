"""
Message classes for the chatbot application.

This module contains the message classes used throughout the app.
By keeping them in a separate module, they remain stable across
Streamlit app reruns, avoiding isinstance comparison issues.
"""
import streamlit as st
from abc import ABC, abstractmethod


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

    def render(self, _):
        with st.chat_message("user"):
            st.markdown(self.content)


class AssistantResponse(Message):
    def __init__(self, messages, request_id, trace_id=None):
        super().__init__()
        self.messages = messages
        self.request_id = request_id
        self.trace_id = trace_id

    def to_input_messages(self):
        return self.messages

    def render(self, idx):
        with st.chat_message("assistant"):
            for msg in self.messages:
                render_message(msg)

            if self.trace_id is not None:
                render_assistant_message_feedback(idx, self.trace_id)


def render_message(msg):
    """Render a single message."""
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


@st.fragment
def render_assistant_message_feedback(i, trace_id):
    """Render feedback UI for assistant messages."""
    from model_serving_utils import submit_feedback
    
    def save_feedback(index):
        submit_feedback(
            trace_id=trace_id,
            rating=st.session_state[f"feedback_{index}"],
        )
    
    st.feedback("thumbs", key=f"feedback_{i}", on_change=save_feedback, args=[i])