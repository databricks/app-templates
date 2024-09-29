import os
from databricks import sql
import pandas as pd
import dash
from dash import dcc, html, Input, Output, State
import plotly.express as px
import dash_bootstrap_components as dbc
import dash_ag_grid as dag
from databricks.sdk.core import Config
from array import array

# Initialize the Dash app with Bootstrap styling
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

chart_data = pd.DataFrame({'x': [x for x in range(30)], 'y': [2 ** x for x in range(30)]})

# Define the app layout
app.layout = dbc.Container([
    dbc.Row([dbc.Col(html.H1("Hello world!!!"), width=12)]),
    dcc.Graph(
        id='fare-scatter',
        figure=px.scatter(chart_data, x='x', y='y',
            labels={'x': 'Apps', 'y': 'Fun with data'},
            template="simple_white"),
        style={'height': '500px', 'width': f'{min(100+50*30, 1000)}px'}
    )
], fluid=True)

if __name__ == "__main__":
    app.run_server(debug=True)