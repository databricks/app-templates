# Shiny for Python LLM Chat Example with Databricks
# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import os
from markdown_it import MarkdownIt
from shiny import App, ui, reactive, run_app
from model_serving_utils import query_endpoint, is_endpoint_supported
from security import SecurityMiddleware

MAX_MESSAGE_CHARS = 4000
MAX_HISTORY_MESSAGES = 20
ALLOWED_ROLES = {"user", "assistant"}

# shinychat's client-side markdown renderer passes raw HTML through (including
# <iframe srcdoc>), so model output is rendered here with raw HTML escaped and
# unsafe link schemes (javascript:, data:, ...) dropped.
model_markdown = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])

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


def to_endpoint_messages(history):
    """Chat history as the OpenAI-style role/content dicts the endpoint expects.

    Only user/assistant roles are forwarded, each message is truncated and
    only the most recent turns are kept.
    """
    messages = [
        {"role": m["role"], "content": str(m["content"])[:MAX_MESSAGE_CHARS]}
        for m in history
        if m["role"] in ALLOWED_ROLES
    ]
    return messages[-MAX_HISTORY_MESSAGES:]

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
        # Raw markdown turns sent to the endpoint; the chat UI holds rendered HTML.
        history = []

        # Clear the chat when user clicks button
        @reactive.Effect
        @reactive.event(input.clear_chat)
        async def _():
            history.clear()
            return await chat.clear_messages()

        # Stream LLM responses into chat when a new message from user arrives
        @chat.on_user_submit
        async def _(user_input: str):
            if len(user_input) > MAX_MESSAGE_CHARS:
                await chat.append_message(
                    f"Your message is too long. Please keep it under {MAX_MESSAGE_CHARS} characters."
                )
                return
            user_turn = {"role": "user", "content": user_input}
            response = query_endpoint(
                endpoint_name=SERVING_ENDPOINT,
                messages=to_endpoint_messages(history + [user_turn]),
                max_tokens=400
            )
            content = str(response.get("content") or "")
            # Only saved once the endpoint replies, so a failed call doesn't leave two user turns in a row.
            history.extend([user_turn, {"role": "assistant", "content": content}])
            await chat.append_message(ui.HTML(model_markdown.render(content)))

app = SecurityMiddleware(App(app_ui, server))

if __name__ == "__main__":
    run_app("app:app")
