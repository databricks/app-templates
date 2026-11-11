# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import gradio as gr
import logging
import os
from starlette.middleware import Middleware
from model_serving_utils import query_endpoint, is_endpoint_supported
from security import SecurityMiddleware

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Ensure environment variable is set correctly
SERVING_ENDPOINT = os.getenv('SERVING_ENDPOINT')
assert SERVING_ENDPOINT,\
    ("Unable to determine serving endpoint to use for chatbot app. If developing locally, "
     "set the SERVING_ENDPOINT environment variable to the name of your serving endpoint. If "
     "deploying to a Databricks app, include a serving endpoint resource named "
     "'serving_endpoint' with CAN_QUERY permissions, as described in "
     "https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app#deploy-the-databricks-app")

# Check if the endpoint is supported
endpoint_supported = is_endpoint_supported(SERVING_ENDPOINT)

MAX_MESSAGE_LENGTH = 4000
MAX_HISTORY_MESSAGES = 20
ALLOWED_HISTORY_ROLES = {"user", "assistant"}

def query_llm(message, history):
    """
    Query the LLM with the given message and chat history.
    `message`: str - the latest user input.
    `history`: list of dicts - OpenAI-style messages.
    """
    if not isinstance(message, str) or not message.strip():
        return "ERROR: The question should not be empty"
    if len(message) > MAX_MESSAGE_LENGTH:
        return f"ERROR: The question must be at most {MAX_MESSAGE_LENGTH} characters"

    # Gradio passes history as OpenAI-style messages; content is a string or a
    # list of content parts. Keep only the text the endpoint can use. History is
    # sent by the browser, so drop any role other than user/assistant (e.g. a
    # forged "system" turn) and cap each turn's length and the number of turns.
    message_history = []
    for msg in history[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(msg, dict) or msg.get("role") not in ALLOWED_HISTORY_ROLES:
            continue
        content = msg.get("content")
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") for part in content
                if isinstance(part, dict) and part.get("type") == "text"
            )
        if isinstance(content, str) and content:
            message_history.append({"role": msg["role"], "content": content[:MAX_MESSAGE_LENGTH]})

    # Add the latest user message
    message_history.append({"role": "user", "content": message})

    try:
        logger.info(f"Sending request to model endpoint: {SERVING_ENDPOINT}")
        response = query_endpoint(
            endpoint_name=SERVING_ENDPOINT,
            messages=message_history,
            max_tokens=400
        )
        return response["content"]
    except Exception as e:
        logger.error(f"Error querying model: {str(e)}", exc_info=True)
        return f"Error: {str(e)}"

# Create Gradio interface based on endpoint support
if not endpoint_supported:
    # Create a simple interface showing the error message
    with gr.Blocks() as demo:
        gr.Markdown("# Databricks LLM Chatbot")
        gr.Markdown(
            f"""
            ⚠️ **Unsupported Endpoint Type**
            
            The endpoint `{SERVING_ENDPOINT}` is not compatible with this basic chatbot template.
            
            This template only supports chat completions-compatible endpoints.
            
            👉 **For a richer chatbot template** that supports all conversational endpoints on Databricks, 
            please see the [Databricks documentation](https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app).
            """
        )
else:
    demo = gr.ChatInterface(
        fn=query_llm,
        title="Databricks LLM Chatbot",
        description=(
            "Note: this is a simple example. See "
            "[Databricks docs](https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app) "
            "for a more comprehensive example, with support for streaming output and more."
        ),
        examples=[
            "What is machine learning?",
            "What are Large Language Models?",
            "What is Databricks?"
        ],
        textbox=gr.Textbox(
            show_label=False,
            placeholder="Type a message...",
            scale=7,
            max_length=MAX_MESSAGE_LENGTH,
        ),
    )

if __name__ == "__main__":
    demo.launch(app_kwargs={"middleware": [Middleware(SecurityMiddleware)]})