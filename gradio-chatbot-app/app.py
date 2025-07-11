import gradio as gr
import logging
import os
from model_serving_utils import query_endpoint

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Ensure environment variable is set correctly
assert os.getenv('SERVING_ENDPOINT'), "SERVING_ENDPOINT must be set in app.yaml."

def query_llm(message, history):
    """
    Query the LLM with the given message and chat history.
    `message`: str - the latest user input.
    `history`: list of dicts - OpenAI-style messages.
    """
    if not message.strip():
        return "ERROR: The question should not be empty"

    # Convert from Gradio-style history to OpenAI-style messages
    message_history = []
    for user_msg, assistant_msg in history:
        message_history.append({"role": "user", "content": user_msg})
        message_history.append({"role": "assistant", "content": assistant_msg})

    # Add the latest user message
    message_history.append({"role": "user", "content": message})

    try:
        logger.info(f"Sending request to model endpoint: {os.getenv('SERVING_ENDPOINT')}")
        response = query_endpoint(
            endpoint_name=os.getenv('SERVING_ENDPOINT'),
            messages=message_history,
            max_tokens=400
        )
        return response["content"]
    except Exception as e:
        logger.error(f"Error querying model: {str(e)}", exc_info=True)
        return f"Error: {str(e)}"

# Create Gradio interface
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
)

if __name__ == "__main__":
    demo.launch()