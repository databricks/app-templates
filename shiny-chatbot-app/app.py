# Shiny for Python LLM Chat Example with Databricks
import os

from databricks.sdk import config
from openai import AsyncOpenAI
from shiny import App, reactive, ui

# Ensure environment variable is set correctly
assert os.getenv("SERVING_ENDPOINT"), "SERVING_ENDPOINT must be set in app.yaml."

# UI is minimal with a 'clear chat' button and the chat dialog
app_ui = ui.page_fillable(ui.panel_title(
    ui.row(ui.column(10, ui.h1("Databricks LLM Chat")),
           ui.column(2, ui.input_action_button("clear_chat", "Clear Chat")))),
                          ui.chat_ui("chat"),
                          title="LLM Chat Example")


def server(input, output, session):
    # Application is using credentials via the `databricks.sdk`
    cfg = config.Config()

    # `openai` library can be configured to use Databricks model serving
    # Databricks model endpoints are openai compatible
    llm = AsyncOpenAI(api_key='',
                      base_url=f"https://{cfg.hostname}/serving-endpoints",
                      default_headers=cfg.authenticate())

    chat = ui.Chat(id="chat", messages=[])

    # Clear the chat when user clicks button
    @reactive.Effect
    @reactive.event(input.clear_chat)
    async def _():
        return await chat.clear_messages()

    # Stream LLM responses into chat when a new message from user arrives
    @chat.on_user_submit
    async def _():
        messages = chat.messages(format="openai")
        response = await llm.chat.completions.create(model=os.getenv("SERVING_ENDPOINT"),
                                                     messages=messages,
                                                     stream=True)
        await chat.append_message_stream(response)


app = App(app_ui, server)

if __name__ == "__main__":
    app.run()
