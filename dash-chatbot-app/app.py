from dotenv import load_dotenv
import dash
from dash import html, Input, Output, State
import dash_bootstrap_components as dbc
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
import os

# Load environment variables (on local development)
# load_dotenv()

# Initialize Databricks WorkspaceClient
w = WorkspaceClient()

# Initialize the Dash app with a clean theme
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.FLATLY])

# Function to call the model endpoint
def call_model_endpoint(endpoint_name, messages, max_tokens=128, timeout_minutes=10):
    chat_messages = [
        ChatMessage(
            content=message["content"],
            role=ChatMessageRole[message["role"].upper()]
        ) if isinstance(message, dict) else ChatMessage(content=message, role=ChatMessageRole.USER)
        for message in messages
    ]
    
    response = w.serving_endpoints.query(
        name=endpoint_name,
        messages=chat_messages,
        max_tokens=max_tokens
    )
    return response.choices[0].message.content

# Define the app layout
app.layout = dbc.Container([
    dbc.Row([
        dbc.Col(html.H1("Databricks Chatbot", className="text-center mb-4"), width=12)
    ]),
    dbc.Row([
        dbc.Col([
            dbc.Card([
                dbc.CardBody([
                    html.Div(id="chat-history", style={
                        "height": "400px",
                        "overflowY": "auto",
                        "marginBottom": "15px",
                        "border": "1px solid #dee2e6",
                        "borderRadius": "5px",
                        "padding": "10px"
                    }),
                    dbc.Row([
                        dbc.Col(dbc.Input(id="user-input", placeholder="Type your message here...", type="text"), width=10),
                        dbc.Col(dbc.Button("Send", id="send-button", color="primary", className="w-100"), width=2)
                    ], className="g-0")
                ])
            ])
        ], width={"size": 8, "offset": 2})
    ])
], fluid=True, className="mt-5")

# Initialize chat history
chat_history = []

@app.callback(
    Output("chat-history", "children"),
    Output("user-input", "value"),
    Input("send-button", "n_clicks"),
    State("user-input", "value"),
    State("chat-history", "children"),
    prevent_initial_call=True
)
def update_chat(n_clicks, user_input, current_history):
    assert os.getenv('SERVING_ENDPOINT'), "SERVING_ENDPOINT must be set in app.yaml."

    if not user_input:
        return current_history, ""

    # Add user message to chat history
    chat_history.append({"role": "user", "content": user_input})
    
    try:
        # Call the Databricks model using the call_model_endpoint function
        assistant_response = call_model_endpoint(
            endpoint_name=os.getenv('SERVING_ENDPOINT'),
            messages=chat_history
        )

        # Add assistant's response to chat history
        chat_history.append({"role": "assistant", "content": assistant_response})

    except Exception as e:
        assistant_response = f"Error: {str(e)}"
        chat_history.append({"role": "assistant", "content": assistant_response})

    # Update the chat display
    chat_display = [
        dbc.Card(
            dbc.CardBody([
                html.Strong(f"{msg['role'].capitalize()}: "),
                html.Span(msg['content'])
            ]),
            className="mb-2",
            color="light" if msg['role'] == "user" else "info"
        ) for msg in chat_history
    ]

    return chat_display, ""

if __name__ == "__main__":
    app.run_server(debug=True)