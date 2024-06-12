from fastapi import FastAPI
import gradio as gr
app = FastAPI()
from gradio.themes.utils import sizes
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

w = WorkspaceClient()

def respond(message, history):
    
    if len(message.strip()) == 0:
        return "ERROR the question should not be empty"

    try:
        response = w.serving_endpoints.query(
            name="databricks-dbrx-instruct", 
            messages=[ChatMessage(content=message, role=ChatMessageRole.USER)],
            temperature=1.0,
            stream=False # SDK does not support stream=True
        )
    except Exception as error:
        response = f"ERROR status_code: {type(error).__name__}"
        

    return response.choices[0].message.content


theme = gr.themes.Soft(
    text_size=sizes.text_sm,radius_size=sizes.radius_sm, spacing_size=sizes.spacing_sm,
)

io = gr.ChatInterface(
    respond,
    chatbot=gr.Chatbot(show_label=False, container=False, show_copy_button=True, bubble_full_width=True),
    textbox=gr.Textbox(placeholder="Ask me a question",
                       container=False, scale=7),
    title="Databricks App demo - Chat with DBRX Databricks model serving endpoint",
    description="This chatbot is a demo example. <br>This content is provided as a LLM educational example, without support. It is using DBRX, can hallucinate and should not be used as production content.<br>Please review our app-templates license and terms for more details.",
    examples=[["What is DBRX?"],
              ["How can I start a Databricks cluster?"],
              ["What is a Databricks Cluster Policy?"],
              ["How can I track billing usage on my workspaces?"],],
    cache_examples=False,
    theme=theme,
    retry_btn=None,
    undo_btn=None,
    clear_btn="Clear",
)

app = gr.mount_gradio_app(app, io, path="/")