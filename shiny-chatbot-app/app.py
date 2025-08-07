# Shiny for Python LLM Chat Example with Databricks
import os
from shiny import App, ui, reactive
from model_serving_utils import query_endpoint, is_endpoint_supported

# Ensure environment variable is set correctly
SERVING_ENDPOINT = os.getenv("SERVING_ENDPOINT")
assert SERVING_ENDPOINT, \
    ("Unable to determine serving endpoint to use for chatbot app. If developing locally, "
     "set the SERVING_ENDPOINT environment variable to the name of your serving endpoint. If "
     "deploying to a Databricks app, include a serving endpoint resource named "
     "'serving_endpoint' with CAN_QUERY permissions, as described in "
     "https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app#deploy-the-databricks-app")

# Check if the endpoint is supported
endpoint_supported = is_endpoint_supported(SERVING_ENDPOINT)

if not endpoint_supported:
    app_ui = ui.page_fillable(
        ui.panel_title(ui.h1("Databricks LLM Chat")),
        ui.card(
            ui.card_header(ui.h3("⚠️ Unsupported Endpoint Type")),
            ui.card_body(
                ui.p(f"The endpoint '{SERVING_ENDPOINT}' is not compatible with this basic chatbot template."),
                ui.p("This template only supports chat completions-compatible endpoints."),
                ui.hr(),
                ui.p(
                    ui.strong("👉 For a richer chatbot template"),
                    " that supports all conversational endpoints on Databricks, please see the ",
                    ui.a("Databricks documentation", 
                         href="https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app",
                         target="_blank"),
                    "."
                )
            )
        ),
        title="LLM Chat Example"
    )
else:
    app_ui = ui.page_fillable(
        ui.markdown(
            "Note: this is a simple example. See "
            "[Databricks docs](https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app) "
            "for a more comprehensive example, with support for streaming output and more."
        ),
        ui.panel_title(
            ui.row(
                ui.column(10, ui.h1("Databricks LLM Chat")),
                ui.column(2, ui.input_action_button("clear_chat", "Clear Chat"))
            )
        ),
        ui.chat_ui("chat"),
        title="LLM Chat Example"
    )

def server(input, output, session):
    if endpoint_supported:
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
            response = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=messages,
                max_tokens=400
            )
            await chat.append_message(response)

app = App(app_ui, server)

if __name__ == "__main__":
    app.run()
