# --- diagnostics bootstrap: install crash/exception logging before app code ---
import os as _diag_os
import sys as _diag_sys

_diag_dir = _diag_os.path.dirname(_diag_os.path.abspath(__file__))
if _diag_dir not in _diag_sys.path:
    _diag_sys.path.insert(0, _diag_dir)
import app_diagnostics  # noqa: E402

app_diagnostics.install_diagnostics()
# --- end diagnostics bootstrap ---

import pandas as pd
from dash import Dash, dcc, html
import plotly.express as px
import dash_bootstrap_components as dbc

# Initialize the Dash app with Bootstrap styling
dash_app = Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

chart_data = pd.DataFrame({'x': [x for x in range(30)],
                           'y': [2 ** x for x in range(30)]})

# Define the app layout
dash_app.layout = dbc.Container([
    dbc.Row([dbc.Col(html.H1('Hello world!!!'), width=12)]),
    dcc.Graph(
        id='fare-scatter',
        figure=px.scatter(chart_data, x='x', y='y',
            labels={'x': 'Apps', 'y': 'Fun with data'},
            template='simple_white'),
        style={'height': '500px', 'width': f'{min(100 + 50 * 30, 1000)}px'}
    )
], fluid=True)

if __name__ == '__main__':
    dash_app.run(debug=True)
