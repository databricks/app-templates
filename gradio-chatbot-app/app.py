import gradio as gr
import logging
import os
from model_serving_utils import query_endpoint, is_endpoint_supported

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
    )

if __name__ == "__main__":
    demo.launch()