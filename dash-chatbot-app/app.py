import os
import dash
import dash_bootstrap_components as dbc
from dash import html
from DatabricksChatbot import DatabricksChatbot
from model_serving_utils import is_endpoint_supported

# Ensure environment variable is set correctly
serving_endpoint = os.getenv('SERVING_ENDPOINT')
assert serving_endpoint, \
    ("Unable to determine serving endpoint to use for chatbot app. If developing locally, "
     "set the SERVING_ENDPOINT environment variable to the name of your serving endpoint. If "
     "deploying to a Databricks app, include a serving endpoint resource named "
     "'serving_endpoint' with CAN_QUERY permissions, as described in "
     "https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app#deploy-the-databricks-app")

# Check if the endpoint is supported
endpoint_supported = is_endpoint_supported(serving_endpoint)

# Initialize the Dash app with a clean theme
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.FLATLY])

# Define the app layout based on endpoint support
if not endpoint_supported:
    app.layout = dbc.Container([
        dbc.Row([
            dbc.Col([
                html.H2('Chat with Databricks AI', className='mb-3'),
                dbc.Alert([
                    html.H5("Endpoint Type Not Supported", className="alert-heading mb-3"),
                    html.P(f"The endpoint '{serving_endpoint}' is not compatible with this basic chatbot template.", 
                           className="mb-2"),
                    html.P("This template only supports chat completions-compatible endpoints.", 
                           className="mb-3"),
                    html.Div([
                        html.P([
                            "For a richer chatbot template that supports all conversational endpoints on Databricks, ",
                            "please visit the ",
                            html.A("Databricks documentation", 
                                   href="https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app",
                                   target="_blank",
                                   className="alert-link"),
                            "."
                        ], className="mb-0")
                    ])
                ], color="info", className="mt-4")
            ], width={'size': 8, 'offset': 2})
        ])
    ], fluid=True)
else:
    # Create the chatbot component with a specified height
    chatbot = DatabricksChatbot(app=app, endpoint_name=serving_endpoint, height='600px')
    
    app.layout = dbc.Container([
        dbc.Row([
            dbc.Col(chatbot.layout, width={'size': 8, 'offset': 2})
        ])
    ], fluid=True)

if __name__ == '__main__':
    app.run(debug=True)
