from shiny import App, ui, reactive
from openai import AsyncOpenAI
from databricks.sdk import config

app_ui = ui.page_fillable(
    ui.input_select("model", "Choose a Model:", choices={
        "databricks-meta-llama-3-1-405b-instruct": "Meta Llama 3.1 405B",
        "databricks-meta-llama-3-1-70b-instruct": "Meta Llama 3.1 70B",
        "databricks-dbrx-instruct": "DBRX",
        "databricks-mixtral-8x7b-instruct": "Mixtral 8x7B",
    }),
    ui.chat_ui("chat"),
    title="LLM Chat Example"
)

def server(input, output, session):
    
    chat = ui.Chat(id="chat", messages=[])
    
    cfg = config.Config()
    llm = AsyncOpenAI(
        api_key='',
        base_url=f"https://{cfg.hostname}/serving-endpoints",
        default_headers=cfg.authenticate()
    )

    @reactive.Effect
    @reactive.event(input.model)
    async def _():
        return await chat.clear_messages()

    # todo: use the input.models()
    @chat.on_user_submit
    async def _():
        messages = chat.messages(format="openai")
        response = await llm.chat.completions.create(
            model=input.model(),
            messages=messages,
            stream=True
        )
        await chat.append_message_stream(response)

app = App(app_ui, server)

if __name__ == "__main__":
    app.run()
