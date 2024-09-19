import gradio as gr
import logging
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize the Databricks Workspace Client
workspace_client = WorkspaceClient()

# Replace with your serving endpoint name
SERVING_ENDPOINT_NAME = 'databricks-meta-llama-3-1-70b-instruct'

def query_llm(message, history):
    """
    Query the LLM with the given message and chat history.
    """
    if not message.strip():
        return "ERROR: The question should not be empty"

    prompt = "Answer this question like a helpful assistant: "
    messages = [ChatMessage(role=ChatMessageRole.USER, content=prompt + message)]

    try:
        logger.info(f"Sending request to model endpoint: {SERVING_ENDPOINT_NAME}")
        response = workspace_client.serving_endpoints.query(
            name=SERVING_ENDPOINT_NAME,
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