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
    """
    if not message.strip():
        return "ERROR: The question should not be empty"

    try:
        logger.info(f"Sending request to model endpoint: {os.getenv('SERVING_ENDPOINT')}")
        return query_endpoint(
            endpoint_name=os.getenv('SERVING_ENDPOINT'),
            messages=[{"role": "user", "content": message}],
            max_tokens=400
        )
    except Exception as e:
        logger.error(f"Error querying model: {str(e)}", exc_info=True)
        return f"Error: {str(e)}"

# Create Gradio interface
demo = gr.ChatInterface(
    fn=query_llm,
    title="Databricks LLM Chatbot",
    description="Ask questions and get responses from a Databricks LLM model.",
    examples=[
        "What is machine learning?",
        "What are Large Language Models?",
        "What is Databricks?"
    ],
)

if __name__ == "__main__":
    demo.launch()