import gradio as gr
import logging
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
import os

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize the Databricks Workspace Client
workspace_client = WorkspaceClient()

# Ensure environment variable is set correctly
assert os.getenv('SERVING_ENDPOINT'), "SERVING_ENDPOINT must be set in app.yaml."

def query_llm(message, history):
    """
    Query the LLM with the given message and chat history.
    """
    if not message.strip():
        return "ERROR: The question should not be empty"

    prompt = "Answer this question like a helpful assistant: "
    messages = [ChatMessage(role=ChatMessageRole.USER, content=prompt + message)]

    try:
        logger.info(f"Sending request to model endpoint: {os.getenv('SERVING_ENDPOINT')}")
        response = workspace_client.serving_endpoints.query(
            name=os.getenv('SERVING_ENDPOINT'),
            messages=messages,
            max_tokens=400
        )
        logger.info("Received response from model endpoint")
        return response.choices[0].message.content
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